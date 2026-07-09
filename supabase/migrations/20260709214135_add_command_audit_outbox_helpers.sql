begin;

set local lock_timeout = '5s';
set local statement_timeout = '30s';

grant gioia_mutator to postgres;
grant create on schema gioia_private to gioia_mutator;

set local role gioia_mutator;

create function gioia_private.owner_scope_hash(p_user_id uuid)
returns bytea
language sql
immutable
strict
security invoker
set search_path = ''
as $$
  select extensions.digest(
    pg_catalog.convert_to('owner:' || p_user_id::text, 'UTF8'),
    'sha256'
  )
$$;

create function gioia_private.begin_command(
  p_operation text,
  p_principal_scope_hash bytea,
  p_idempotency_key text,
  p_request_fingerprint bytea
)
returns table (
  command_request_id uuid,
  replayed boolean,
  stored_http_status smallint,
  stored_response jsonb
)
language plpgsql
volatile
security invoker
set search_path = ''
as $$
declare
  v_inserted_id uuid;
  v_request gioia_private.command_requests%rowtype;
begin
  if p_principal_scope_hash is null
    or p_request_fingerprint is null
    or pg_catalog.octet_length(p_principal_scope_hash) <> 32
    or pg_catalog.octet_length(p_request_fingerprint) <> 32 then
    raise sqlstate 'PT400' using message = 'COMMAND_HASH_INVALID';
  end if;

  insert into gioia_private.command_requests (
    operation,
    principal_scope_hash,
    idempotency_key,
    request_fingerprint,
    expires_at
  ) values (
    p_operation,
    p_principal_scope_hash,
    p_idempotency_key,
    p_request_fingerprint,
    pg_catalog.statement_timestamp() + interval '7 days'
  )
  on conflict (operation, principal_scope_hash, idempotency_key) do nothing
  returning id into v_inserted_id;

  if v_inserted_id is not null then
    return query select v_inserted_id, false, null::smallint, null::jsonb;
    return;
  end if;

  select request.*
  into strict v_request
  from gioia_private.command_requests as request
  where request.operation = p_operation
    and request.principal_scope_hash = p_principal_scope_hash
    and request.idempotency_key = p_idempotency_key
  for update;

  if v_request.request_fingerprint is distinct from p_request_fingerprint then
    raise sqlstate 'PT409' using message = 'IDEMPOTENCY_KEY_REUSED';
  end if;
  if v_request.state = 'in_progress' then
    raise sqlstate 'PT409' using message = 'COMMAND_IN_PROGRESS';
  end if;

  return query
  select v_request.id, true, v_request.http_status, v_request.response_snapshot;
end;
$$;

create function gioia_private.complete_command(
  p_command_request_id uuid,
  p_http_status smallint,
  p_resource_kind text,
  p_resource_id uuid,
  p_code text
)
returns jsonb
language plpgsql
volatile
security invoker
set search_path = ''
as $$
declare
  v_response jsonb;
begin
  update gioia_private.command_requests as request
  set state = 'completed',
      resource_kind = p_resource_kind,
      resource_id = p_resource_id,
      http_status = p_http_status,
      error_code = null,
      response_snapshot = pg_catalog.jsonb_build_object(
        'code', p_code,
        'resource_id', p_resource_id
      ),
      completed_at = pg_catalog.statement_timestamp()
  where request.id = p_command_request_id
    and request.state = 'in_progress'
  returning request.response_snapshot into v_response;

  if v_response is null then
    raise exception using errcode = '23514', message = 'COMMAND_COMPLETION_INVALID';
  end if;
  return v_response;
end;
$$;

create function gioia_private.fail_command(
  p_command_request_id uuid,
  p_http_status smallint,
  p_error_code text
)
returns jsonb
language plpgsql
volatile
security invoker
set search_path = ''
as $$
declare
  v_response jsonb;
begin
  update gioia_private.command_requests as request
  set state = 'failed',
      http_status = p_http_status,
      error_code = p_error_code,
      response_snapshot = pg_catalog.jsonb_build_object('code', p_error_code),
      completed_at = pg_catalog.statement_timestamp()
  where request.id = p_command_request_id
    and request.state = 'in_progress'
  returning request.response_snapshot into v_response;

  if v_response is null then
    raise exception using errcode = '23514', message = 'COMMAND_FAILURE_INVALID';
  end if;
  return v_response;
end;
$$;

create function gioia_private.record_domain_change(
  p_aggregate_kind text,
  p_aggregate_id uuid,
  p_aggregate_version integer,
  p_change_kind text,
  p_source text,
  p_command_request_id uuid,
  p_actor_user_id uuid,
  p_changed_fields text[]
)
returns void
language sql
volatile
security invoker
set search_path = ''
as $$
  insert into gioia_private.domain_change_log (
    aggregate_kind,
    aggregate_id,
    aggregate_version,
    change_kind,
    source,
    command_request_id,
    actor_user_id,
    changed_fields
  ) values (
    p_aggregate_kind,
    p_aggregate_id,
    p_aggregate_version,
    p_change_kind,
    p_source,
    p_command_request_id,
    p_actor_user_id,
    p_changed_fields
  )
$$;

create function gioia_private.enqueue_schedule_emails(
  p_entry gioia_private.schedule_entries,
  p_template_base text,
  p_old_local_date date default null,
  p_old_start_minutes smallint default null
)
returns void
language plpgsql
volatile
security invoker
set search_path = ''
as $$
declare
  v_owner_address extensions.citext;
  v_template_data jsonb;
begin
  if p_entry.kind <> 'appointment'
    or p_template_base not in ('booking', 'cancellation', 'reschedule') then
    raise exception using errcode = '23514', message = 'OUTBOX_TEMPLATE_INVALID';
  end if;
  if (p_template_base = 'reschedule') is distinct from
    (p_old_local_date is not null and p_old_start_minutes is not null) then
    raise exception using errcode = '23514', message = 'OUTBOX_RESCHEDULE_SNAPSHOT_INVALID';
  end if;

  select policy.admin_notification_email
  into strict v_owner_address
  from gioia_private.booking_policy as policy
  where policy.singleton;

  v_template_data := pg_catalog.jsonb_build_object(
    'client_name', p_entry.client_name,
    'local_date', p_entry.local_date::text,
    'start_minutes', p_entry.start_minutes,
    'service_duration_minutes', p_entry.service_duration_minutes,
    'service_name', p_entry.service_name_snapshot,
    'variant_name', p_entry.variant_name_snapshot
  );
  if p_template_base = 'reschedule' then
    v_template_data := v_template_data || pg_catalog.jsonb_build_object(
      'old_local_date', p_old_local_date::text,
      'old_start_minutes', p_old_start_minutes
    );
  end if;

  insert into gioia_private.email_outbox (
    aggregate_kind, aggregate_id, aggregate_version, recipient_kind,
    recipient_address, template_kind, template_data, idempotency_key
  ) values (
    'schedule_entry', p_entry.id, p_entry.version, 'owner',
    v_owner_address, p_template_base || '_owner', v_template_data,
    'schedule:' || p_entry.id::text || ':v' || p_entry.version::text
      || ':' || p_template_base || ':owner'
  );

  if p_entry.client_email is not null then
    insert into gioia_private.email_outbox (
      aggregate_kind, aggregate_id, aggregate_version, recipient_kind,
      recipient_address, template_kind, template_data, idempotency_key
    ) values (
      'schedule_entry', p_entry.id, p_entry.version, 'customer',
      p_entry.client_email, p_template_base || '_customer', v_template_data,
      'schedule:' || p_entry.id::text || ':v' || p_entry.version::text
        || ':' || p_template_base || ':customer'
    );
  end if;
end;
$$;

reset role;

revoke create on schema gioia_private from gioia_mutator;

revoke all on function gioia_private.owner_scope_hash(uuid)
  from public, anon, authenticated, service_role, app_runtime, gioia_migrator;
revoke all on function gioia_private.begin_command(text, bytea, text, bytea)
  from public, anon, authenticated, service_role, app_runtime, gioia_migrator;
revoke all on function gioia_private.complete_command(uuid, smallint, text, uuid, text)
  from public, anon, authenticated, service_role, app_runtime, gioia_migrator;
revoke all on function gioia_private.fail_command(uuid, smallint, text)
  from public, anon, authenticated, service_role, app_runtime, gioia_migrator;
revoke all on function gioia_private.record_domain_change(
  text, uuid, integer, text, text, uuid, uuid, text[]
) from public, anon, authenticated, service_role, app_runtime, gioia_migrator;
revoke all on function gioia_private.enqueue_schedule_emails(
  gioia_private.schedule_entries, text, date, smallint
) from public, anon, authenticated, service_role, app_runtime, gioia_migrator;

revoke gioia_mutator from postgres;

commit;

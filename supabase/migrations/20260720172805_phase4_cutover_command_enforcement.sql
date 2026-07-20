begin;

set local lock_timeout = '5s';
set local statement_timeout = '30s';

grant gioia_mutator to postgres;
grant create on schema gioia_private to gioia_mutator;
set local role gioia_mutator;

create function gioia_private.authorize_cutover_write(
  p_operation text,
  p_idempotency_key text,
  p_request_fingerprint bytea,
  p_canary_token text
)
returns table (is_canary boolean, canary_run_id uuid, canary_grant_id uuid)
language plpgsql volatile security definer set search_path = ''
as $$
declare
  v_control gioia_private.cutover_write_control%rowtype;
  v_grant gioia_private.cutover_canary_grants%rowtype;
  v_run gioia_private.cutover_canary_runs%rowtype;
begin
  if p_operation is null or p_operation !~ '^[a-z][a-z0-9_]{1,63}$'
    or p_idempotency_key is null
    or p_idempotency_key !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
    or p_request_fingerprint is null
    or pg_catalog.octet_length(p_request_fingerprint) <> 32 then
    raise sqlstate 'PT503' using message = 'MAINTENANCE_ACTIVE';
  end if;

  perform pg_catalog.set_config('gioia.cutover_operation', p_operation, true);
  perform pg_catalog.set_config(
    'gioia.cutover_idempotency_key', p_idempotency_key, true
  );
  perform pg_catalog.set_config(
    'gioia.cutover_request_fingerprint',
    pg_catalog.encode(p_request_fingerprint, 'hex'), true
  );
  perform pg_catalog.set_config('gioia.cutover_canary_run_id', '', true);
  perform pg_catalog.set_config('gioia.cutover_suppress_outbox', '', true);

  select * into strict v_control
  from gioia_private.cutover_write_control as control
  where control.singleton for share;

  if v_control.mode = 'open' then
    if p_canary_token is not null then
      raise sqlstate 'PT503' using message = 'MAINTENANCE_ACTIVE';
    end if;
    return query select false, null::uuid, null::uuid;
    return;
  end if;

  if v_control.mode = 'owner_reconcile'
    and p_operation like 'owner\_%' escape '\' then
    if p_canary_token is not null then
      raise sqlstate 'PT503' using message = 'MAINTENANCE_ACTIVE';
    end if;
    perform pg_catalog.set_config('gioia.cutover_suppress_outbox', 'true', true);
    return query select false, null::uuid, null::uuid;
    return;
  end if;

  if v_control.mode <> 'frozen' or p_canary_token is null
    or p_canary_token !~ '^[A-Za-z0-9_-]{43}$' then
    raise sqlstate 'PT503' using message = 'MAINTENANCE_ACTIVE';
  end if;

  select grant_row.* into v_grant
  from gioia_private.cutover_canary_grants as grant_row
  where grant_row.token_sha256 = extensions.digest(p_canary_token, 'sha256')
  for update;
  if not found then
    raise sqlstate 'PT503' using message = 'MAINTENANCE_ACTIVE';
  end if;

  select run.* into strict v_run
  from gioia_private.cutover_canary_runs as run
  where run.id = v_grant.run_id for share;
  if v_run.freeze_id <> v_control.freeze_id or v_run.status <> 'active'
    or v_run.expires_at <= statement_timestamp()
    or v_grant.status = 'revoked'
    or v_grant.expires_at <= statement_timestamp()
    or v_grant.operation <> p_operation
    or v_grant.idempotency_key <> p_idempotency_key
    or v_grant.request_fingerprint <> p_request_fingerprint then
    raise sqlstate 'PT503' using message = 'MAINTENANCE_ACTIVE';
  end if;

  if v_grant.status = 'issued' then
    update gioia_private.cutover_canary_grants
    set status = 'used', used_at = statement_timestamp()
    where id = v_grant.id;
    insert into gioia_private.cutover_canary_events (
      grant_id, run_id, freeze_id, operation, event_kind
    ) values (v_grant.id, v_run.id, v_run.freeze_id, p_operation, 'authorized');
  end if;

  perform pg_catalog.set_config(
    'gioia.cutover_canary_run_id', v_run.id::text, true
  );
  return query select true, v_run.id, v_grant.id;
end;
$$;

create or replace function gioia_private.begin_command(
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
language plpgsql volatile security invoker set search_path = ''
as $$
declare
  v_inserted_id uuid;
  v_request gioia_private.command_requests%rowtype;
  v_cutover_mode text;
begin
  if p_operation in (
    'public_booking', 'owner_create_appointment', 'owner_create_block',
    'owner_update_appointment_details', 'owner_update_block_details',
    'owner_reschedule_appointment', 'owner_reschedule_block',
    'owner_set_appointment_status', 'owner_cancel_schedule_entry',
    'owner_create_vacation', 'owner_update_vacation', 'owner_cancel_vacation',
    'owner_unsubscribe_subscriber', 'owner_outbox_retry'
  ) then
    select mode into strict v_cutover_mode
    from gioia_private.cutover_write_control where singleton;
    if v_cutover_mode <> 'open' and (
      pg_catalog.current_setting('gioia.cutover_operation', true)
        is distinct from p_operation
      or pg_catalog.current_setting('gioia.cutover_idempotency_key', true)
        is distinct from p_idempotency_key
      or pg_catalog.current_setting('gioia.cutover_request_fingerprint', true)
        is distinct from pg_catalog.encode(p_request_fingerprint, 'hex')
    ) then
      raise sqlstate 'PT503' using message = 'MAINTENANCE_ACTIVE';
    end if;
  end if;

  if p_principal_scope_hash is null or p_request_fingerprint is null
    or pg_catalog.octet_length(p_principal_scope_hash) <> 32
    or pg_catalog.octet_length(p_request_fingerprint) <> 32 then
    raise sqlstate 'PT400' using message = 'COMMAND_HASH_INVALID';
  end if;

  insert into gioia_private.command_requests (
    operation, principal_scope_hash, idempotency_key,
    request_fingerprint, expires_at
  ) values (
    p_operation, p_principal_scope_hash, p_idempotency_key,
    p_request_fingerprint, pg_catalog.statement_timestamp() + interval '7 days'
  )
  on conflict (operation, principal_scope_hash, idempotency_key) do nothing
  returning id into v_inserted_id;

  if v_inserted_id is not null then
    return query select v_inserted_id, false, null::smallint, null::jsonb;
    return;
  end if;

  select request.* into strict v_request
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

create function gioia_private.suppress_cutover_canary_outbox()
returns trigger language plpgsql volatile security invoker set search_path = ''
as $$
begin
  if nullif(
    pg_catalog.current_setting('gioia.cutover_canary_run_id', true), ''
  ) is not null or pg_catalog.current_setting(
    'gioia.cutover_suppress_outbox', true
  ) = 'true' then
    return null;
  end if;
  return new;
end;
$$;

reset role;

create trigger email_outbox_cutover_canary_suppression
before insert on gioia_private.email_outbox
for each row execute function gioia_private.suppress_cutover_canary_outbox();

revoke create on schema gioia_private from gioia_mutator;
revoke all on function gioia_private.authorize_cutover_write(text,text,bytea,text)
  from public, anon, authenticated, service_role, gioia_migrator;
grant execute on function gioia_private.authorize_cutover_write(text,text,bytea,text)
  to app_runtime;
revoke all on function gioia_private.suppress_cutover_canary_outbox()
  from public, anon, authenticated, service_role, app_runtime, gioia_migrator;
revoke gioia_mutator from postgres;

commit;

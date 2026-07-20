begin;

set local lock_timeout = '5s';
set local statement_timeout = '30s';

grant gioia_mutator to postgres;
grant create on schema gioia_private to gioia_mutator;

set local role gioia_mutator;

create function gioia_private.begin_email_outbox_provider_attempt(
  p_outbox_id uuid,
  p_expected_version integer,
  p_worker_id text
)
returns table (
  outbox_id uuid,
  allowed boolean,
  terminal_reason text,
  provider_idempotency_key text,
  first_provider_attempt_at timestamptz,
  provider_retry_deadline_at timestamptz,
  current_version integer
)
language plpgsql
volatile
security definer
set search_path = ''
rows 1
as $$
declare
  v_outbox gioia_private.email_outbox%rowtype;
  v_now timestamptz := pg_catalog.statement_timestamp();
begin
  if p_outbox_id is null or p_expected_version is null or p_expected_version < 1
    or p_worker_id is null or pg_catalog.length(p_worker_id) not between 1 and 100
    or p_worker_id !~ '^[A-Za-z0-9:_-]+$' then
    raise sqlstate 'PT400' using message = 'OUTBOX_PROVIDER_ATTEMPT_INVALID';
  end if;
  select outbox.* into v_outbox
  from gioia_private.email_outbox as outbox
  where outbox.id = p_outbox_id and outbox.version = p_expected_version
    and outbox.status = 'sending' and outbox.locked_by = p_worker_id
    and outbox.lease_expires_at > v_now
  for update;
  if not found then
    raise sqlstate 'PT409' using message = 'OUTBOX_CLAIM_STALE';
  end if;
  if v_outbox.provider_retry_deadline_at is not null
    and v_outbox.provider_retry_deadline_at <= v_now then
    update gioia_private.email_outbox as outbox
    set status = 'dead_letter', locked_at = null, locked_by = null,
        lease_expires_at = null, last_error_code = 'PROVIDER_RETRY_WINDOW_EXPIRED'
    where outbox.id = v_outbox.id
    returning outbox.* into strict v_outbox;
    return query select v_outbox.id, false, 'PROVIDER_RETRY_WINDOW_EXPIRED'::text,
      null::text, v_outbox.first_provider_attempt_at,
      v_outbox.provider_retry_deadline_at, v_outbox.version;
    return;
  end if;
  if v_outbox.first_provider_attempt_at is null then
    update gioia_private.email_outbox as outbox
    set first_provider_attempt_at = v_now,
        provider_retry_deadline_at = v_now + interval '24 hours'
    where outbox.id = v_outbox.id
    returning outbox.* into strict v_outbox;
  end if;
  return query select v_outbox.id, true, null::text, v_outbox.idempotency_key,
    v_outbox.first_provider_attempt_at, v_outbox.provider_retry_deadline_at,
    v_outbox.version;
end;
$$;

create or replace function gioia_private.complete_email_outbox_success(
  p_outbox_id uuid,
  p_expected_version integer,
  p_worker_id text,
  p_provider_message_id text
)
returns table (outbox_id uuid, delivery_status text, attempt_count smallint, current_version integer)
language plpgsql
volatile
security definer
set search_path = ''
as $$
begin
  if p_provider_message_id is null
    or pg_catalog.length(pg_catalog.btrim(p_provider_message_id)) not between 1 and 255 then
    raise sqlstate 'PT400' using message = 'PROVIDER_MESSAGE_ID_INVALID';
  end if;
  return query update gioia_private.email_outbox as outbox
  set status = 'sent', provider_message_id = pg_catalog.btrim(p_provider_message_id),
      sent_at = pg_catalog.statement_timestamp(), locked_at = null, locked_by = null,
      lease_expires_at = null, last_error_code = null
  where outbox.id = p_outbox_id and outbox.version = p_expected_version
    and outbox.status = 'sending' and outbox.locked_by = p_worker_id
    and outbox.lease_expires_at > pg_catalog.statement_timestamp()
    and outbox.first_provider_attempt_at is not null
    and outbox.provider_retry_deadline_at > pg_catalog.statement_timestamp()
  returning outbox.id, outbox.status, outbox.attempt_count, outbox.version;
  if not found then raise sqlstate 'PT409' using message = 'OUTBOX_CLAIM_STALE'; end if;
exception when unique_violation then
  raise sqlstate 'PT409' using message = 'PROVIDER_MESSAGE_ID_REUSED';
end;
$$;

create or replace function gioia_private.complete_email_outbox_failure(
  p_outbox_id uuid,
  p_expected_version integer,
  p_worker_id text,
  p_error_code text,
  p_retryable boolean
)
returns table (
  outbox_id uuid, delivery_status text, attempt_count smallint,
  current_version integer, next_attempt_at timestamptz
)
language plpgsql
volatile
security definer
set search_path = ''
as $$
begin
  if p_retryable is null or p_error_code is null
    or p_error_code !~ '^[A-Z][A-Z0-9_]{1,63}$' then
    raise sqlstate 'PT400' using message = 'OUTBOX_COMPLETION_INVALID';
  end if;
  return query update gioia_private.email_outbox as outbox
  set status = case when p_retryable and outbox.attempt_count < 5
      and outbox.provider_retry_deadline_at > pg_catalog.statement_timestamp()
      then 'failed' else 'dead_letter' end,
    next_attempt_at = case
      when not p_retryable or outbox.attempt_count >= 5
        or outbox.provider_retry_deadline_at <= pg_catalog.statement_timestamp()
        then pg_catalog.statement_timestamp()
      when outbox.attempt_count = 1 then pg_catalog.statement_timestamp() + interval '1 minute'
      when outbox.attempt_count = 2 then pg_catalog.statement_timestamp() + interval '5 minutes'
      when outbox.attempt_count = 3 then pg_catalog.statement_timestamp() + interval '15 minutes'
      else pg_catalog.statement_timestamp() + interval '1 hour' end,
    locked_at = null, locked_by = null, lease_expires_at = null,
    last_error_code = case when outbox.provider_retry_deadline_at <= pg_catalog.statement_timestamp()
      then 'PROVIDER_RETRY_WINDOW_EXPIRED' else p_error_code end
  where outbox.id = p_outbox_id and outbox.version = p_expected_version
    and outbox.status = 'sending' and outbox.locked_by = p_worker_id
    and outbox.lease_expires_at > pg_catalog.statement_timestamp()
    and outbox.first_provider_attempt_at is not null
  returning outbox.id, outbox.status, outbox.attempt_count, outbox.version, outbox.next_attempt_at;
  if not found then raise sqlstate 'PT409' using message = 'OUTBOX_CLAIM_STALE'; end if;
end;
$$;

create or replace function gioia_private.retry_email_outbox_as_owner(
  p_actor_user_id uuid,
  p_idempotency_key text,
  p_request_fingerprint bytea,
  p_outbox_id uuid,
  p_expected_version integer
)
returns table (http_status smallint, result jsonb, replayed boolean)
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_command_id uuid; v_replayed boolean; v_status smallint; v_result jsonb;
  v_outbox gioia_private.email_outbox%rowtype;
begin
  perform gioia_private.assert_enabled_owner(p_actor_user_id);
  select command_request_id, command.replayed, stored_http_status, stored_response
  into strict v_command_id, v_replayed, v_status, v_result
  from gioia_private.begin_command(
    'owner_outbox_retry', gioia_private.owner_scope_hash(p_actor_user_id),
    p_idempotency_key, p_request_fingerprint
  ) as command;
  if v_replayed then return query select v_status, v_result, true; return; end if;
  update gioia_private.email_outbox as outbox
  set status = 'failed', next_attempt_at = pg_catalog.statement_timestamp(),
      locked_at = null, locked_by = null, lease_expires_at = null
  where outbox.id = p_outbox_id and outbox.version = p_expected_version
    and outbox.status in ('failed','dead_letter') and outbox.attempt_count < 20
    and (outbox.provider_retry_deadline_at is null
      or outbox.provider_retry_deadline_at > pg_catalog.statement_timestamp())
  returning outbox.* into v_outbox;
  if not found then
    v_status := 409;
    v_result := gioia_private.fail_command(v_command_id, v_status, 'OUTBOX_RETRY_CONFLICT');
  else
    v_status := 200;
    v_result := gioia_private.complete_command(
      v_command_id, v_status, 'outbox', v_outbox.id, 'OUTBOX_RETRY_SCHEDULED'
    );
  end if;
  return query select v_status, v_result, false;
end;
$$;


reset role;

revoke create on schema gioia_private from gioia_mutator;

commit;

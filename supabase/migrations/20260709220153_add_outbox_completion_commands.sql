begin;

set local lock_timeout = '5s';
set local statement_timeout = '30s';

grant gioia_mutator to postgres;
grant create on schema gioia_private to gioia_mutator;

set local role gioia_mutator;

create function gioia_private.complete_email_outbox_success(
  p_outbox_id uuid,
  p_expected_version integer,
  p_worker_id text,
  p_provider_message_id text
)
returns table (
  outbox_id uuid,
  delivery_status text,
  attempt_count smallint,
  current_version integer
)
language plpgsql
volatile
security definer
set search_path = ''
as $$
begin
  if p_outbox_id is null or p_expected_version is null or p_expected_version < 1 then
    raise sqlstate 'PT400' using message = 'OUTBOX_COMPLETION_INVALID';
  end if;
  if p_worker_id is null
    or pg_catalog.length(p_worker_id) not between 1 and 100
    or p_worker_id !~ '^[A-Za-z0-9:_-]+$' then
    raise sqlstate 'PT400' using message = 'OUTBOX_WORKER_INVALID';
  end if;
  if p_provider_message_id is null
    or pg_catalog.length(pg_catalog.btrim(p_provider_message_id)) not between 1 and 255 then
    raise sqlstate 'PT400' using message = 'PROVIDER_MESSAGE_ID_INVALID';
  end if;

  return query
  update gioia_private.email_outbox as outbox
  set status = 'sent',
      provider_message_id = pg_catalog.btrim(p_provider_message_id),
      sent_at = pg_catalog.statement_timestamp(),
      locked_at = null,
      locked_by = null,
      lease_expires_at = null,
      last_error_code = null
  where outbox.id = p_outbox_id
    and outbox.version = p_expected_version
    and outbox.status = 'sending'
    and outbox.locked_by = p_worker_id
    and outbox.lease_expires_at > pg_catalog.statement_timestamp()
  returning outbox.id, outbox.status, outbox.attempt_count, outbox.version;

  if not found then
    raise sqlstate 'PT409' using message = 'OUTBOX_CLAIM_STALE';
  end if;
exception
  when unique_violation then
    raise sqlstate 'PT409' using message = 'PROVIDER_MESSAGE_ID_REUSED';
end;
$$;

create function gioia_private.complete_email_outbox_failure(
  p_outbox_id uuid,
  p_expected_version integer,
  p_worker_id text,
  p_error_code text,
  p_retryable boolean
)
returns table (
  outbox_id uuid,
  delivery_status text,
  attempt_count smallint,
  current_version integer,
  next_attempt_at timestamptz
)
language plpgsql
volatile
security definer
set search_path = ''
as $$
begin
  if p_outbox_id is null or p_expected_version is null or p_expected_version < 1
    or p_retryable is null then
    raise sqlstate 'PT400' using message = 'OUTBOX_COMPLETION_INVALID';
  end if;
  if p_worker_id is null
    or pg_catalog.length(p_worker_id) not between 1 and 100
    or p_worker_id !~ '^[A-Za-z0-9:_-]+$' then
    raise sqlstate 'PT400' using message = 'OUTBOX_WORKER_INVALID';
  end if;
  if p_error_code is null
    or p_error_code !~ '^[A-Z][A-Z0-9_]{1,63}$' then
    raise sqlstate 'PT400' using message = 'OUTBOX_ERROR_CODE_INVALID';
  end if;

  return query
  update gioia_private.email_outbox as outbox
  set status = case
        when p_retryable and outbox.attempt_count < 5 then 'failed'
        else 'dead_letter'
      end,
      next_attempt_at = case
        when not p_retryable or outbox.attempt_count >= 5
          then pg_catalog.statement_timestamp()
        when outbox.attempt_count = 1
          then pg_catalog.statement_timestamp() + interval '1 minute'
        when outbox.attempt_count = 2
          then pg_catalog.statement_timestamp() + interval '5 minutes'
        when outbox.attempt_count = 3
          then pg_catalog.statement_timestamp() + interval '15 minutes'
        else pg_catalog.statement_timestamp() + interval '1 hour'
      end,
      locked_at = null,
      locked_by = null,
      lease_expires_at = null,
      last_error_code = p_error_code
  where outbox.id = p_outbox_id
    and outbox.version = p_expected_version
    and outbox.status = 'sending'
    and outbox.locked_by = p_worker_id
    and outbox.lease_expires_at > pg_catalog.statement_timestamp()
  returning outbox.id, outbox.status, outbox.attempt_count,
    outbox.version, outbox.next_attempt_at;

  if not found then
    raise sqlstate 'PT409' using message = 'OUTBOX_CLAIM_STALE';
  end if;
end;
$$;

comment on function gioia_private.complete_email_outbox_failure(
  uuid, integer, text, text, boolean
) is 'Schedules bounded retries through attempt four and dead-letters attempt five.';

reset role;

revoke create on schema gioia_private from gioia_mutator;
revoke gioia_mutator from postgres;

revoke all on function gioia_private.complete_email_outbox_success(
  uuid, integer, text, text
) from public, anon, authenticated, service_role, app_runtime, gioia_migrator;
revoke all on function gioia_private.complete_email_outbox_failure(
  uuid, integer, text, text, boolean
) from public, anon, authenticated, service_role, app_runtime, gioia_migrator;
grant execute on function gioia_private.complete_email_outbox_success(
  uuid, integer, text, text
) to app_runtime;
grant execute on function gioia_private.complete_email_outbox_failure(
  uuid, integer, text, text, boolean
) to app_runtime;

commit;

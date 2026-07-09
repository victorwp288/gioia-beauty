begin;

set local lock_timeout = '5s';
set local statement_timeout = '30s';

grant gioia_mutator to postgres;
grant create on schema gioia_private to gioia_mutator;

set local role gioia_mutator;

create function gioia_private.retry_email_outbox_as_owner(
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
  v_command_id uuid;
  v_replayed boolean;
  v_status smallint;
  v_result jsonb;
  v_outbox gioia_private.email_outbox%rowtype;
begin
  perform gioia_private.assert_enabled_owner(p_actor_user_id);

  select command_request_id, command.replayed,
    stored_http_status, stored_response
  into strict v_command_id, v_replayed, v_status, v_result
  from gioia_private.begin_command(
    'owner_outbox_retry',
    gioia_private.owner_scope_hash(p_actor_user_id),
    p_idempotency_key,
    p_request_fingerprint
  ) as command;

  if v_replayed then
    return query select v_status, v_result, true;
    return;
  end if;

  update gioia_private.email_outbox as outbox
  set status = 'failed',
      next_attempt_at = pg_catalog.statement_timestamp(),
      locked_at = null,
      locked_by = null,
      lease_expires_at = null
  where outbox.id = p_outbox_id
    and outbox.version = p_expected_version
    and outbox.status in ('failed', 'dead_letter')
    and outbox.attempt_count < 20
  returning outbox.* into v_outbox;

  if not found then
    v_status := 409;
    v_result := gioia_private.fail_command(
      v_command_id, v_status, 'OUTBOX_RETRY_CONFLICT'
    );
  else
    v_status := 200;
    v_result := gioia_private.complete_command(
      v_command_id, v_status, 'outbox', v_outbox.id,
      'OUTBOX_RETRY_SCHEDULED'
    );
  end if;

  return query select v_status, v_result, false;
end;
$$;

reset role;

revoke create on schema gioia_private from gioia_mutator;
revoke gioia_mutator from postgres;

revoke all on function gioia_private.retry_email_outbox_as_owner(
  uuid, text, bytea, uuid, integer
) from public, anon, authenticated, service_role, app_runtime, gioia_migrator;
grant execute on function gioia_private.retry_email_outbox_as_owner(
  uuid, text, bytea, uuid, integer
) to app_runtime;

commit;

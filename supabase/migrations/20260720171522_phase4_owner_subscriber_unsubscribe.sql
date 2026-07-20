begin;

set local lock_timeout = '5s';
set local statement_timeout = '30s';

grant gioia_mutator to postgres;
grant create on schema gioia_private to gioia_mutator;

set local role gioia_mutator;

create function gioia_private.owner_unsubscribe_subscriber(
  p_actor_user_id uuid,
  p_idempotency_key text,
  p_request_fingerprint bytea,
  p_subscriber_id uuid,
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
  v_error_code text;
  v_subscriber gioia_private.newsletter_subscribers%rowtype;
begin
  perform gioia_private.assert_enabled_owner(p_actor_user_id);

  select command_request_id, command.replayed,
    stored_http_status, stored_response
  into strict v_command_id, v_replayed, v_status, v_result
  from gioia_private.begin_command(
    'owner_unsubscribe_subscriber',
    gioia_private.owner_scope_hash(p_actor_user_id),
    p_idempotency_key,
    p_request_fingerprint
  ) as command;

  if v_replayed then
    return query select v_status, v_result, true;
    return;
  end if;

  begin
    select subscriber.*
    into v_subscriber
    from gioia_private.newsletter_subscribers as subscriber
    where subscriber.id = p_subscriber_id
    for update;

    if not found then
      raise sqlstate 'PT404' using message = 'SUBSCRIBER_NOT_FOUND';
    end if;
    if v_subscriber.version is distinct from p_expected_version then
      raise sqlstate 'PT409' using message = 'VERSION_CONFLICT';
    end if;
    if v_subscriber.status not in (
      'legacy_unverified', 'pending', 'active', 'bounced'
    ) then
      raise sqlstate 'PT409'
        using message = 'SUBSCRIBER_NOT_UNSUBSCRIBABLE';
    end if;

    update gioia_private.newsletter_subscribers as subscriber
    set status = 'unsubscribed',
        unsubscribed_at = pg_catalog.statement_timestamp()
    where subscriber.id = p_subscriber_id
      and subscriber.version = p_expected_version
    returning subscriber.* into strict v_subscriber;

    perform gioia_private.record_domain_change(
      'subscriber', v_subscriber.id, v_subscriber.version, 'unsubscribe',
      'admin', v_command_id, p_actor_user_id,
      array['status', 'unsubscribed_at']::text[]
    );

    v_status := 200;
    v_result := gioia_private.complete_command(
      v_command_id, v_status, 'subscriber', v_subscriber.id,
      'SUBSCRIBER_UNSUBSCRIBED'
    );
  exception
    when sqlstate 'PT404' then
      get stacked diagnostics v_error_code = message_text;
      v_status := 404;
      v_result := gioia_private.fail_command(
        v_command_id, v_status, v_error_code
      );
    when sqlstate 'PT409' then
      get stacked diagnostics v_error_code = message_text;
      v_status := 409;
      v_result := gioia_private.fail_command(
        v_command_id, v_status, v_error_code
      );
  end;

  return query select v_status, v_result, false;
end;
$$;

reset role;

revoke create on schema gioia_private from gioia_mutator;

revoke all on function gioia_private.owner_unsubscribe_subscriber(
  uuid, text, bytea, uuid, integer
) from public, anon, authenticated, service_role, app_runtime, gioia_migrator;
grant execute on function gioia_private.owner_unsubscribe_subscriber(
  uuid, text, bytea, uuid, integer
) to app_runtime;

revoke gioia_mutator from postgres;

commit;

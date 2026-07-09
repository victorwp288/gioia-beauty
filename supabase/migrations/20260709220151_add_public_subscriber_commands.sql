begin;

set local lock_timeout = '5s';
set local statement_timeout = '30s';

grant gioia_mutator to postgres;
grant create on schema gioia_private to gioia_mutator;

set local role gioia_mutator;

create function gioia_private.subscribe_public_newsletter(
  p_principal_scope_hash bytea,
  p_idempotency_key text,
  p_request_fingerprint bytea,
  p_email text
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
  v_stored jsonb;
  v_email text;
  v_subscriber gioia_private.newsletter_subscribers%rowtype;
  v_changed boolean := false;
begin
  select command_request_id, command.replayed, stored_http_status, stored_response
  into strict v_command_id, v_replayed, v_status, v_stored
  from gioia_private.begin_command(
    'public_newsletter_subscribe', p_principal_scope_hash,
    p_idempotency_key, p_request_fingerprint
  ) as command;

  if v_replayed then
    return query select v_status,
      case when v_status = 202
        then pg_catalog.jsonb_build_object('code', 'REQUEST_ACCEPTED')
        else v_stored end,
      true;
    return;
  end if;

  begin
    v_email := pg_catalog.lower(pg_catalog.btrim(p_email));
    if v_email is null or pg_catalog.length(v_email) not between 3 and 320
      or pg_catalog.strpos(v_email, '@') < 2
      or v_email ~ '[[:space:]]' then
      raise sqlstate 'PT400' using message = 'PUBLIC_EMAIL_INVALID';
    end if;

    insert into gioia_private.newsletter_subscribers (
      email, status, source, consent_at, consent_source, consent_policy_version
    ) values (
      v_email::extensions.citext, 'pending', 'public',
      pg_catalog.statement_timestamp(), 'public_form', 'newsletter-consent-v1'
    )
    on conflict (email) do nothing
    returning * into v_subscriber;

    if found then
      v_changed := true;
    else
      select subscriber.* into strict v_subscriber
      from gioia_private.newsletter_subscribers as subscriber
      where subscriber.email = v_email::extensions.citext
      for update;

      if v_subscriber.status in ('legacy_unverified', 'unsubscribed', 'bounced') then
        update gioia_private.newsletter_subscribers as subscriber
        set status = 'pending',
            consent_at = pg_catalog.statement_timestamp(),
            consent_source = 'public_form',
            consent_policy_version = 'newsletter-consent-v1',
            confirmed_at = null,
            unsubscribed_at = null
        where subscriber.id = v_subscriber.id
        returning subscriber.* into strict v_subscriber;
        v_changed := true;
      end if;
    end if;

    if v_changed then
      perform gioia_private.record_domain_change(
        'subscriber', v_subscriber.id, v_subscriber.version, 'subscribe',
        'public', v_command_id, null,
        array['status', 'consent_at', 'consent_source', 'consent_policy_version']
      );
      insert into gioia_private.email_outbox (
        aggregate_kind, aggregate_id, aggregate_version, recipient_kind,
        recipient_address, template_kind, template_data, idempotency_key
      ) values (
        'subscriber', v_subscriber.id, v_subscriber.version, 'subscriber',
        v_subscriber.email, 'newsletter_confirmation',
        pg_catalog.jsonb_build_object('policy_version', 'newsletter-consent-v1'),
        'subscriber:' || v_subscriber.id::text || ':v'
          || v_subscriber.version::text || ':confirmation'
      );
    end if;

    v_status := 202;
    perform gioia_private.complete_command(
      v_command_id, v_status, 'subscriber', v_subscriber.id, 'REQUEST_ACCEPTED'
    );
  exception
    when sqlstate 'PT400' then
      v_status := 400;
      perform gioia_private.fail_command(
        v_command_id, v_status, 'PUBLIC_EMAIL_INVALID'
      );
  end;

  return query select v_status,
    case when v_status = 202
      then pg_catalog.jsonb_build_object('code', 'REQUEST_ACCEPTED')
      else pg_catalog.jsonb_build_object('code', 'PUBLIC_EMAIL_INVALID') end,
    false;
end;
$$;

create function gioia_private.confirm_public_newsletter(
  p_subscriber_id uuid,
  p_principal_scope_hash bytea,
  p_idempotency_key text,
  p_request_fingerprint bytea
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
  v_stored jsonb;
  v_subscriber gioia_private.newsletter_subscribers%rowtype;
begin
  select command_request_id, command.replayed, stored_http_status, stored_response
  into strict v_command_id, v_replayed, v_status, v_stored
  from gioia_private.begin_command(
    'public_newsletter_confirm', p_principal_scope_hash,
    p_idempotency_key, p_request_fingerprint
  ) as command;

  if not v_replayed then
    select subscriber.* into v_subscriber
    from gioia_private.newsletter_subscribers as subscriber
    where subscriber.id = p_subscriber_id
    for update;

    if found and v_subscriber.status = 'pending' then
      update gioia_private.newsletter_subscribers as subscriber
      set status = 'active', confirmed_at = pg_catalog.statement_timestamp()
      where subscriber.id = v_subscriber.id
      returning subscriber.* into strict v_subscriber;
      perform gioia_private.record_domain_change(
        'subscriber', v_subscriber.id, v_subscriber.version, 'update',
        'public', v_command_id, null, array['status', 'confirmed_at']
      );
    end if;

    v_status := 202;
    perform gioia_private.complete_command(
      v_command_id, v_status, 'subscriber', p_subscriber_id, 'REQUEST_ACCEPTED'
    );
  end if;

  return query select v_status,
    pg_catalog.jsonb_build_object('code', 'REQUEST_ACCEPTED'), v_replayed;
end;
$$;

create function gioia_private.unsubscribe_public_newsletter(
  p_subscriber_id uuid,
  p_principal_scope_hash bytea,
  p_idempotency_key text,
  p_request_fingerprint bytea
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
  v_stored jsonb;
  v_subscriber gioia_private.newsletter_subscribers%rowtype;
begin
  select command_request_id, command.replayed, stored_http_status, stored_response
  into strict v_command_id, v_replayed, v_status, v_stored
  from gioia_private.begin_command(
    'public_newsletter_unsubscribe', p_principal_scope_hash,
    p_idempotency_key, p_request_fingerprint
  ) as command;

  if not v_replayed then
    select subscriber.* into v_subscriber
    from gioia_private.newsletter_subscribers as subscriber
    where subscriber.id = p_subscriber_id
    for update;

    if found and v_subscriber.status in (
      'legacy_unverified', 'pending', 'active', 'bounced'
    ) then
      update gioia_private.newsletter_subscribers as subscriber
      set status = 'unsubscribed',
          unsubscribed_at = pg_catalog.statement_timestamp()
      where subscriber.id = v_subscriber.id
      returning subscriber.* into strict v_subscriber;
      perform gioia_private.record_domain_change(
        'subscriber', v_subscriber.id, v_subscriber.version, 'unsubscribe',
        'public', v_command_id, null, array['status', 'unsubscribed_at']
      );
    end if;

    v_status := 202;
    perform gioia_private.complete_command(
      v_command_id, v_status, 'subscriber', p_subscriber_id, 'REQUEST_ACCEPTED'
    );
  end if;

  return query select v_status,
    pg_catalog.jsonb_build_object('code', 'REQUEST_ACCEPTED'), v_replayed;
end;
$$;

reset role;

revoke create on schema gioia_private from gioia_mutator;
revoke gioia_mutator from postgres;

revoke all on function gioia_private.subscribe_public_newsletter(
  bytea, text, bytea, text
) from public, anon, authenticated, service_role, app_runtime, gioia_migrator;
revoke all on function gioia_private.confirm_public_newsletter(
  uuid, bytea, text, bytea
) from public, anon, authenticated, service_role, app_runtime, gioia_migrator;
revoke all on function gioia_private.unsubscribe_public_newsletter(
  uuid, bytea, text, bytea
) from public, anon, authenticated, service_role, app_runtime, gioia_migrator;
grant execute on function gioia_private.subscribe_public_newsletter(
  bytea, text, bytea, text
) to app_runtime;
grant execute on function gioia_private.confirm_public_newsletter(
  uuid, bytea, text, bytea
) to app_runtime;
grant execute on function gioia_private.unsubscribe_public_newsletter(
  uuid, bytea, text, bytea
) to app_runtime;

commit;

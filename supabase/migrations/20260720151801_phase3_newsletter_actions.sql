begin;

set local lock_timeout = '5s';
set local statement_timeout = '30s';

grant gioia_mutator to postgres;
grant create on schema gioia_private to gioia_mutator;

set local role gioia_mutator;

create function gioia_private.confirm_public_newsletter(
  p_subscriber_id uuid,
  p_subscriber_version integer,
  p_token_id uuid,
  p_token_version integer,
  p_issued_at timestamptz,
  p_expires_at timestamptz,
  p_signing_key_id text,
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
  v_token gioia_private.newsletter_action_tokens%rowtype;
  v_subscriber gioia_private.newsletter_subscribers%rowtype;
begin
  select command_request_id, command.replayed, stored_http_status
  into strict v_command_id, v_replayed, v_status
  from gioia_private.begin_command(
    'public_newsletter_confirm', p_principal_scope_hash,
    p_idempotency_key, p_request_fingerprint
  ) as command;
  if not v_replayed then
    select token.* into v_token
    from gioia_private.newsletter_action_tokens as token
    where token.token_id = p_token_id
    for update;
    if found
      and v_token.purpose = 'newsletter_confirm'
      and v_token.subscriber_id = p_subscriber_id
      and v_token.subscriber_version = p_subscriber_version
      and v_token.token_version = p_token_version
      and v_token.issued_at = p_issued_at
      and v_token.expires_at = p_expires_at
      and v_token.signing_key_id = p_signing_key_id
      and v_token.consumed_at is null
      and pg_catalog.statement_timestamp() < v_token.expires_at then
      select subscriber.* into v_subscriber
      from gioia_private.newsletter_subscribers as subscriber
      where subscriber.id = p_subscriber_id
        and subscriber.version = p_subscriber_version
        and subscriber.status = 'pending'
      for update;
      if found then
        update gioia_private.newsletter_action_tokens as token
        set consumed_at = pg_catalog.statement_timestamp(),
            consumed_command_request_id = v_command_id
        where token.token_id = v_token.token_id;
        update gioia_private.newsletter_subscribers as subscriber
        set status = 'active', confirmed_at = pg_catalog.statement_timestamp()
        where subscriber.id = v_subscriber.id
        returning subscriber.* into strict v_subscriber;
        insert into gioia_private.newsletter_consent_events (
          consent_cycle_id, subscriber_id, subscriber_version,
          event_kind, action_token_id, command_request_id
        ) values (
          v_token.consent_cycle_id, v_subscriber.id, p_subscriber_version,
          'confirmed', v_token.token_id, v_command_id
        );
        perform gioia_private.record_domain_change(
          'subscriber', v_subscriber.id, v_subscriber.version, 'update',
          'public', v_command_id, null, array['status', 'confirmed_at']
        );
      end if;
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
  p_subscriber_version integer,
  p_token_id uuid,
  p_token_version integer,
  p_issued_at timestamptz,
  p_expires_at timestamptz,
  p_signing_key_id text,
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
  v_token gioia_private.newsletter_action_tokens%rowtype;
  v_subscriber gioia_private.newsletter_subscribers%rowtype;
begin
  select command_request_id, command.replayed, stored_http_status
  into strict v_command_id, v_replayed, v_status
  from gioia_private.begin_command(
    'public_newsletter_unsubscribe', p_principal_scope_hash,
    p_idempotency_key, p_request_fingerprint
  ) as command;
  if not v_replayed then
    select token.* into v_token
    from gioia_private.newsletter_action_tokens as token
    where token.token_id = p_token_id
    for update;
    if found
      and v_token.purpose = 'newsletter_unsubscribe'
      and v_token.subscriber_id = p_subscriber_id
      and v_token.subscriber_version = p_subscriber_version
      and v_token.token_version = p_token_version
      and v_token.issued_at = p_issued_at
      and v_token.expires_at = p_expires_at
      and v_token.signing_key_id = p_signing_key_id
      and v_token.consumed_at is null
      and pg_catalog.statement_timestamp() < v_token.expires_at then
      select subscriber.* into v_subscriber
      from gioia_private.newsletter_subscribers as subscriber
      where subscriber.id = p_subscriber_id
        and subscriber.version = p_subscriber_version
        and subscriber.status in ('pending', 'active', 'bounced')
      for update;
      if found then
        update gioia_private.newsletter_action_tokens as token
        set consumed_at = pg_catalog.statement_timestamp(),
            consumed_command_request_id = v_command_id
        where token.token_id = v_token.token_id;
        update gioia_private.newsletter_subscribers as subscriber
        set status = 'unsubscribed', unsubscribed_at = pg_catalog.statement_timestamp()
        where subscriber.id = v_subscriber.id
        returning subscriber.* into strict v_subscriber;
        insert into gioia_private.newsletter_consent_events (
          consent_cycle_id, subscriber_id, subscriber_version,
          event_kind, action_token_id, command_request_id
        ) values (
          v_token.consent_cycle_id, v_subscriber.id, p_subscriber_version,
          'withdrawn', v_token.token_id, v_command_id
        );
        perform gioia_private.record_domain_change(
          'subscriber', v_subscriber.id, v_subscriber.version, 'unsubscribe',
          'public', v_command_id, null, array['status', 'unsubscribed_at']
        );
      end if;
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

commit;

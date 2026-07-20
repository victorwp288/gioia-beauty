begin;

set local lock_timeout = '5s';
set local statement_timeout = '30s';

grant gioia_mutator to postgres;
grant create on schema gioia_private to gioia_mutator;
set local role gioia_mutator;

create or replace function gioia_private.canonicalize_newsletter_action_token_times()
returns trigger language plpgsql security invoker set search_path = pg_catalog as $$
declare v_verify_until timestamptz;
begin
  new.issued_at := date_trunc('milliseconds', new.issued_at);
  new.expires_at := date_trunc('milliseconds', new.expires_at);
  select signing_key.verify_until into v_verify_until
  from gioia_private.newsletter_action_signing_keys as signing_key
  where signing_key.key_id = new.signing_key_id
    and signing_key.issue_enabled;
  if v_verify_until is null or (
    new.purpose = 'newsletter_confirm'
    and v_verify_until < new.expires_at + interval '30 days'
  ) or (
    new.purpose = 'newsletter_unsubscribe'
    and v_verify_until < new.expires_at
  ) then
    raise sqlstate 'PT503' using message = 'NEWSLETTER_CONFIGURATION_UNAVAILABLE';
  end if;
  return new;
end;
$$;

create or replace function gioia_private.confirm_public_newsletter(
  p_subscriber_id uuid, p_subscriber_version integer, p_token_id uuid,
  p_token_version integer, p_issued_at timestamptz, p_expires_at timestamptz,
  p_signing_key_id text, p_principal_scope_hash bytea,
  p_idempotency_key text, p_request_fingerprint bytea
)
returns table (http_status smallint, result jsonb, replayed boolean)
language plpgsql volatile security definer set search_path = '' as $$
declare
  v_command_id uuid; v_replayed boolean; v_status smallint;
  v_token gioia_private.newsletter_action_tokens%rowtype;
  v_subscriber gioia_private.newsletter_subscribers%rowtype;
  v_old_cycle gioia_private.newsletter_consent_cycles%rowtype;
  v_active_cycle gioia_private.newsletter_consent_cycles%rowtype;
  v_verification_key gioia_private.newsletter_action_signing_keys%rowtype;
  v_issue_key gioia_private.newsletter_action_signing_keys%rowtype;
  v_now timestamptz := pg_catalog.statement_timestamp();
begin
  select command_request_id, command.replayed, stored_http_status
  into strict v_command_id, v_replayed, v_status
  from gioia_private.begin_command('public_newsletter_confirm', p_principal_scope_hash,
    p_idempotency_key, p_request_fingerprint) as command;
  if not v_replayed then
    select token.* into v_token from gioia_private.newsletter_action_tokens as token
    where token.token_id = p_token_id for update;
    select signing_key.* into v_verification_key
    from gioia_private.newsletter_action_signing_keys as signing_key
    where signing_key.key_id = p_signing_key_id
      and signing_key.verify_until >= v_now;
    select signing_key.* into v_issue_key
    from gioia_private.newsletter_action_signing_keys as signing_key
    where signing_key.issue_enabled
      and signing_key.verify_until >= v_now + interval '30 days';
    if v_verification_key.key_id is not null and v_issue_key.key_id is not null
      and v_token.purpose = 'newsletter_confirm'
      and v_token.subscriber_id = p_subscriber_id
      and v_token.subscriber_version = p_subscriber_version
      and v_token.token_version = p_token_version and v_token.issued_at = p_issued_at
      and v_token.expires_at = p_expires_at and v_token.signing_key_id = p_signing_key_id
      and v_token.consumed_at is null and v_now < v_token.expires_at then
      select subscriber.* into v_subscriber
      from gioia_private.newsletter_subscribers as subscriber
      where subscriber.id = p_subscriber_id and subscriber.version = p_subscriber_version
        and subscriber.status = 'pending' for update;
      if found then
        select cycle.* into strict v_old_cycle
        from gioia_private.newsletter_consent_cycles as cycle
        where cycle.id = v_token.consent_cycle_id;
        update gioia_private.newsletter_action_tokens as token
        set consumed_at = v_now, consumed_command_request_id = v_command_id
        where token.token_id = v_token.token_id;
        update gioia_private.newsletter_subscribers as subscriber
        set status = 'active', confirmed_at = v_now
        where subscriber.id = v_subscriber.id returning subscriber.* into strict v_subscriber;
        insert into gioia_private.newsletter_consent_cycles (
          subscriber_id, subscriber_version, consent_at, consent_source,
          policy_version, artifact_version, artifact_sha256, template_version
        ) values (
          v_subscriber.id, v_subscriber.version, v_old_cycle.consent_at,
          v_old_cycle.consent_source, v_old_cycle.policy_version,
          v_old_cycle.artifact_version, v_old_cycle.artifact_sha256,
          v_old_cycle.template_version
        ) returning * into strict v_active_cycle;
        insert into gioia_private.newsletter_action_tokens (
          token_id, consent_cycle_id, subscriber_id, subscriber_version,
          purpose, signing_key_id, issued_at, expires_at
        ) values (
          extensions.gen_random_uuid(), v_active_cycle.id, v_subscriber.id,
          v_subscriber.version, 'newsletter_unsubscribe', v_issue_key.key_id,
          v_now, v_now + interval '30 days'
        );
        insert into gioia_private.newsletter_consent_events (
          consent_cycle_id, subscriber_id, subscriber_version,
          event_kind, action_token_id, command_request_id
        ) values (v_old_cycle.id, v_subscriber.id, p_subscriber_version,
          'confirmed', v_token.token_id, v_command_id);
        perform gioia_private.record_domain_change('subscriber', v_subscriber.id,
          v_subscriber.version, 'update', 'public', v_command_id, null,
          array['status', 'confirmed_at']);
      end if;
    end if;
    v_status := 202;
    perform gioia_private.complete_command(v_command_id, v_status,
      'subscriber', p_subscriber_id, 'REQUEST_ACCEPTED');
  end if;
  return query select v_status,
    pg_catalog.jsonb_build_object('code', 'REQUEST_ACCEPTED'), v_replayed;
end;
$$;

reset role;
revoke create on schema gioia_private from gioia_mutator;
revoke gioia_mutator from postgres;

commit;

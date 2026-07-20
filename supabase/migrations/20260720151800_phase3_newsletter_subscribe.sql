begin;

set local lock_timeout = '5s';
set local statement_timeout = '30s';

grant gioia_mutator to postgres;
grant create on schema gioia_private to gioia_mutator;

set local role gioia_mutator;

drop function gioia_private.subscribe_public_newsletter(bytea,text,bytea,text);
drop function gioia_private.confirm_public_newsletter(uuid,bytea,text,bytea);
drop function gioia_private.unsubscribe_public_newsletter(uuid,bytea,text,bytea);

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
  v_artifact gioia_private.newsletter_consent_artifacts%rowtype;
  v_key gioia_private.newsletter_action_signing_keys%rowtype;
  v_old_cycle gioia_private.newsletter_consent_cycles%rowtype;
  v_cycle gioia_private.newsletter_consent_cycles%rowtype;
  v_token gioia_private.newsletter_action_tokens%rowtype;
  v_changed boolean := false;
  v_now timestamptz := pg_catalog.statement_timestamp();
begin
  select command_request_id, command.replayed, stored_http_status, stored_response
  into strict v_command_id, v_replayed, v_status, v_stored
  from gioia_private.begin_command(
    'public_newsletter_subscribe', p_principal_scope_hash,
    p_idempotency_key, p_request_fingerprint
  ) as command;
  if v_replayed then
    return query select v_status, v_stored, true;
    return;
  end if;

  v_email := pg_catalog.lower(pg_catalog.btrim(p_email));
  if v_email is null or pg_catalog.length(v_email) not between 3 and 320
    or pg_catalog.strpos(v_email, '@') < 2 or v_email ~ '[[:space:]]' then
    v_status := 400;
    v_stored := gioia_private.fail_command(v_command_id, v_status, 'PUBLIC_EMAIL_INVALID');
    return query select v_status, v_stored, false;
    return;
  end if;

  select artifact.* into v_artifact
  from gioia_private.newsletter_consent_artifacts as artifact
  where artifact.effective_at <= v_now and artifact.retired_at is null;
  select signing_key.* into v_key
  from gioia_private.newsletter_action_signing_keys as signing_key
  where signing_key.issue_enabled and signing_key.verify_until >= v_now + interval '24 hours';
  if v_artifact.artifact_version is null or v_key.key_id is null then
    v_status := 503;
    v_stored := gioia_private.fail_command(
      v_command_id, v_status, 'NEWSLETTER_CONFIGURATION_UNAVAILABLE'
    );
    return query select v_status, v_stored, false;
    return;
  end if;

  insert into gioia_private.newsletter_subscribers (
    email, status, source, consent_at, consent_source, consent_policy_version
  ) values (
    v_email::extensions.citext, 'pending', 'public', v_now,
    'public_form', v_artifact.policy_version
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
      set status = 'pending', consent_at = v_now, consent_source = 'public_form',
          consent_policy_version = v_artifact.policy_version,
          confirmed_at = null, unsubscribed_at = null
      where subscriber.id = v_subscriber.id
      returning subscriber.* into strict v_subscriber;
      v_changed := true;
    elsif v_subscriber.status = 'pending' then
      select cycle.* into v_old_cycle
      from gioia_private.newsletter_consent_cycles as cycle
      join gioia_private.newsletter_action_tokens as token
        on token.consent_cycle_id = cycle.id and token.purpose = 'newsletter_confirm'
      where cycle.subscriber_id = v_subscriber.id
        and cycle.subscriber_version = v_subscriber.version
        and token.consumed_at is null
      order by token.issue_sequence desc
      limit 1;
      if v_old_cycle.id is null or not exists (
        select 1 from gioia_private.newsletter_action_tokens as token
        where token.consent_cycle_id = v_old_cycle.id
          and token.purpose = 'newsletter_confirm'
          and token.expires_at >= v_now + interval '15 minutes'
      ) then
        update gioia_private.newsletter_subscribers as subscriber
        set consent_at = v_now, consent_source = 'public_form',
            consent_policy_version = v_artifact.policy_version
        where subscriber.id = v_subscriber.id
        returning subscriber.* into strict v_subscriber;
        v_changed := true;
      end if;
    end if;
  end if;

  if v_changed then
    if v_old_cycle.id is not null then
      insert into gioia_private.newsletter_consent_events (
        consent_cycle_id, subscriber_id, subscriber_version,
        event_kind, command_request_id
      ) values (
        v_old_cycle.id, v_subscriber.id, v_old_cycle.subscriber_version,
        'superseded', v_command_id
      );
    end if;
    insert into gioia_private.newsletter_consent_cycles (
      subscriber_id, subscriber_version, consent_at, consent_source,
      policy_version, artifact_version, artifact_sha256
    ) values (
      v_subscriber.id, v_subscriber.version, v_now, 'public_form',
      v_artifact.policy_version, v_artifact.artifact_version, v_artifact.content_sha256
    ) returning * into strict v_cycle;

    insert into gioia_private.newsletter_action_tokens (
      token_id, consent_cycle_id, subscriber_id, subscriber_version,
      purpose, signing_key_id, issued_at, expires_at
    ) values (
      extensions.gen_random_uuid(), v_cycle.id, v_subscriber.id, v_subscriber.version,
      'newsletter_confirm', v_key.key_id, v_now, v_now + interval '24 hours'
    ) returning * into strict v_token;

    insert into gioia_private.newsletter_consent_events (
      consent_cycle_id, subscriber_id, subscriber_version,
      event_kind, command_request_id
    ) values (
      v_cycle.id, v_subscriber.id, v_subscriber.version, 'requested', v_command_id
    );

    perform gioia_private.record_domain_change(
      'subscriber', v_subscriber.id, v_subscriber.version, 'subscribe',
      'public', v_command_id, null,
      array['status', 'consent_at', 'consent_source', 'consent_policy_version']
    );

    insert into gioia_private.email_outbox (
      aggregate_kind, aggregate_id, aggregate_version, recipient_kind,
      recipient_address, template_kind, template_version, template_data,
      newsletter_action_token_id, idempotency_key
    ) values (
      'subscriber', v_subscriber.id, v_subscriber.version, 'subscriber',
      v_subscriber.email, 'newsletter_confirmation', 1,
      pg_catalog.jsonb_build_object(
        'policyVersion', v_artifact.policy_version,
        'consentArtifactVersion', v_artifact.artifact_version,
        'consentArtifactSha256', pg_catalog.encode(v_artifact.content_sha256, 'hex'),
        'action', pg_catalog.jsonb_build_object(
          'version', v_token.token_version,
          'purpose', v_token.purpose,
          'tokenId', v_token.token_id::text,
          'issuedAt', pg_catalog.to_char(v_token.issued_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
          'expiresAt', pg_catalog.to_char(v_token.expires_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
          'signingKeyId', v_token.signing_key_id
        )
      ),
      v_token.token_id,
      'subscriber:' || v_subscriber.id::text || ':v' || v_subscriber.version::text || ':confirmation'
    );
  end if;

  v_status := 202;
  v_stored := gioia_private.complete_command(
    v_command_id, v_status, 'subscriber', v_subscriber.id, 'REQUEST_ACCEPTED'
  );
  return query select v_status,
    pg_catalog.jsonb_build_object('code', 'REQUEST_ACCEPTED'), false;
end;
$$;


reset role;

revoke create on schema gioia_private from gioia_mutator;

commit;

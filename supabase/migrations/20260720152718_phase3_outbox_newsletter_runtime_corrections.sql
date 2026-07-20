begin;

set local lock_timeout = '5s';
set local statement_timeout = '30s';
grant gioia_mutator to postgres;
grant create on schema gioia_private to gioia_mutator;
create or replace function gioia_private.enforce_newsletter_subscriber_transition()
returns trigger language plpgsql security invoker set search_path = pg_catalog as $$
begin
  if row(old.id, old.schema_version, old.email, old.source,
    old.legacy_firestore_id, old.timestamp_provenance, old.imported_at, old.created_at)
    is distinct from row(new.id, new.schema_version, new.email, new.source,
    new.legacy_firestore_id, new.timestamp_provenance, new.imported_at, new.created_at) then
    raise exception using errcode = '23514', message = 'Subscriber identity and provenance are immutable';
  end if;
  if old.status <> new.status and not (
    (old.status = 'legacy_unverified' and new.status in ('pending', 'unsubscribed'))
    or (old.status = 'pending' and new.status in ('active', 'unsubscribed', 'bounced', 'complained'))
    or (old.status = 'active' and new.status in ('unsubscribed', 'bounced', 'complained'))
    or (old.status = 'unsubscribed' and new.status = 'pending')
    or (old.status = 'bounced' and new.status in ('pending', 'unsubscribed', 'complained'))
  ) then
    raise exception using errcode = '23514', message = 'Invalid subscriber status transition';
  end if;
  if row(old.consent_at, old.consent_source, old.consent_policy_version)
    is distinct from row(new.consent_at, new.consent_source, new.consent_policy_version)
    and not ((old.status in ('legacy_unverified', 'unsubscribed', 'bounced') and new.status = 'pending')
      or (old.status = 'pending' and new.status = 'pending')) then
    raise exception using errcode = '23514', message = 'Subscriber consent evidence is immutable';
  end if;
  if old.confirmed_at is distinct from new.confirmed_at and not (
    (old.confirmed_at is null and new.confirmed_at is not null
      and old.status = 'pending' and new.status = 'active')
    or (old.confirmed_at is not null and new.confirmed_at is null
      and old.status in ('unsubscribed', 'bounced') and new.status = 'pending'
      and row(old.consent_at, old.consent_source, old.consent_policy_version)
        is distinct from row(new.consent_at, new.consent_source, new.consent_policy_version))
  ) then
    raise exception using errcode = '23514', message = 'Subscriber confirmation is immutable';
  end if;
  if old.unsubscribed_at is not null and old.unsubscribed_at is distinct from new.unsubscribed_at
    and new.status <> 'pending' then
    raise exception using errcode = '23514', message = 'Subscriber unsubscribe evidence is immutable';
  end if;
  return new;
end;
$$;

set local role gioia_mutator;

create function gioia_private.canonicalize_newsletter_action_token_times()
returns trigger language plpgsql security invoker set search_path = pg_catalog as $$
declare v_verify_until timestamptz;
begin
  new.issued_at := date_trunc('milliseconds', new.issued_at);
  new.expires_at := date_trunc('milliseconds', new.expires_at);
  select signing_key.verify_until into v_verify_until
  from gioia_private.newsletter_action_signing_keys as signing_key
  where signing_key.key_id = new.signing_key_id and signing_key.issue_enabled;
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

reset role;
create trigger newsletter_action_tokens_canonical_times
before insert on gioia_private.newsletter_action_tokens
for each row execute function gioia_private.canonicalize_newsletter_action_token_times();
set local role gioia_mutator;

create function gioia_private.complete_email_outbox_pre_provider_failure(
  p_outbox_id uuid, p_expected_version integer, p_worker_id text,
  p_error_code text, p_retryable boolean
)
returns table (outbox_id uuid, delivery_status text, attempt_count smallint,
  current_version integer, next_attempt_at timestamptz)
language plpgsql volatile security definer set search_path = '' as $$
begin
  if (p_error_code, p_retryable) not in (
    ('OUTBOX_RENDERER_UNAVAILABLE', true), ('OUTBOX_TEMPLATE_INVALID', false)
  ) then
    raise sqlstate 'PT400' using message = 'OUTBOX_PRE_PROVIDER_COMPLETION_INVALID';
  end if;
  return query update gioia_private.email_outbox as outbox
  set status = case when p_retryable and outbox.attempt_count < 5 then 'failed' else 'dead_letter' end,
    next_attempt_at = case when p_retryable and outbox.attempt_count < 5
      then pg_catalog.statement_timestamp() + interval '5 minutes'
      else pg_catalog.statement_timestamp() end,
    locked_at = null, locked_by = null, lease_expires_at = null,
    last_error_code = p_error_code
  where outbox.id = p_outbox_id and outbox.version = p_expected_version
    and outbox.status = 'sending' and outbox.locked_by = p_worker_id
    and outbox.lease_expires_at > pg_catalog.statement_timestamp()
    and outbox.first_provider_attempt_at is null
  returning outbox.id, outbox.status, outbox.attempt_count, outbox.version,
    outbox.next_attempt_at;
  if not found then raise sqlstate 'PT409' using message = 'OUTBOX_CLAIM_STALE'; end if;
end;
$$;

create or replace function gioia_private.complete_email_outbox_success(
  p_outbox_id uuid, p_expected_version integer, p_worker_id text,
  p_provider_message_id text
)
returns table (outbox_id uuid, delivery_status text, attempt_count smallint,
  current_version integer)
language plpgsql volatile security definer set search_path = '' as $$
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
  returning outbox.id, outbox.status, outbox.attempt_count, outbox.version;
  if not found then raise sqlstate 'PT409' using message = 'OUTBOX_CLAIM_STALE'; end if;
exception when unique_violation then
  raise sqlstate 'PT409' using message = 'PROVIDER_MESSAGE_ID_REUSED';
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
  v_key gioia_private.newsletter_action_signing_keys%rowtype;
  v_now timestamptz := pg_catalog.statement_timestamp();
begin
  select command_request_id, command.replayed, stored_http_status
  into strict v_command_id, v_replayed, v_status
  from gioia_private.begin_command('public_newsletter_confirm', p_principal_scope_hash,
    p_idempotency_key, p_request_fingerprint) as command;
  if not v_replayed then
    select token.* into v_token from gioia_private.newsletter_action_tokens as token
    where token.token_id = p_token_id for update;
    select signing_key.* into v_key
    from gioia_private.newsletter_action_signing_keys as signing_key
    where signing_key.issue_enabled and signing_key.verify_until >= v_now + interval '30 days';
    if found and v_token.purpose = 'newsletter_confirm'
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
          v_subscriber.version, 'newsletter_unsubscribe', v_key.key_id,
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
alter table gioia_private.email_outbox
  drop constraint email_outbox_template_data_shape;
alter table gioia_private.email_outbox
  add constraint email_outbox_template_data_shape check (
    case when jsonb_typeof(template_data) = 'object' then (
      (template_kind = 'newsletter_confirmation' and (
        template_data ?& array['policyVersion', 'consentArtifactVersion',
          'consentArtifactSha256', 'action']
        and template_data - array['policyVersion', 'consentArtifactVersion',
          'consentArtifactSha256', 'action'] = '{}'::jsonb
        and jsonb_typeof(template_data -> 'policyVersion') = 'string'
        and jsonb_typeof(template_data -> 'consentArtifactVersion') = 'string'
        and jsonb_typeof(template_data -> 'consentArtifactSha256') = 'string'
        and (template_data ->> 'policyVersion') ~ '^[a-z0-9][a-z0-9._-]{2,99}$'
        and (template_data ->> 'consentArtifactVersion') ~ '^[a-z0-9][a-z0-9._-]{2,99}$'
        and (template_data ->> 'consentArtifactSha256') ~ '^[0-9a-f]{64}$'
        and jsonb_typeof(template_data -> 'action') = 'object'
        and (template_data -> 'action') ?& array['version', 'purpose', 'tokenId',
          'issuedAt', 'expiresAt', 'signingKeyId']
        and (template_data -> 'action') - array['version', 'purpose', 'tokenId',
          'issuedAt', 'expiresAt', 'signingKeyId'] = '{}'::jsonb
        and jsonb_typeof(template_data #> '{action,version}') = 'number'
        and jsonb_typeof(template_data #> '{action,purpose}') = 'string'
        and template_data #>> '{action,version}' = '1'
        and template_data #>> '{action,purpose}' = 'newsletter_confirm'
        and (template_data #>> '{action,tokenId}')
          ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
        and (template_data #>> '{action,issuedAt}') ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}T'
        and (template_data #>> '{action,expiresAt}') ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}T'
        and (template_data #>> '{action,signingKeyId}') ~ '^[A-Za-z0-9_]{1,16}$'
      ))
      or (template_kind <> 'newsletter_confirmation' and (
        template_data ?& array['client_name', 'local_date', 'start_minutes',
          'service_duration_minutes', 'service_name', 'variant_name']
        and template_data - array['client_name', 'local_date', 'start_minutes',
          'service_duration_minutes', 'service_name', 'variant_name',
          'old_local_date', 'old_start_minutes'] = '{}'::jsonb
        and jsonb_typeof(template_data -> 'client_name') = 'string'
        and length(btrim(template_data ->> 'client_name')) between 1 and 160
        and jsonb_typeof(template_data -> 'local_date') = 'string'
        and (template_data ->> 'local_date') ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$'
        and jsonb_typeof(template_data -> 'start_minutes') = 'number'
        and case when (template_data ->> 'start_minutes') ~ '^(0|[1-9][0-9]{0,3})$'
          then (template_data ->> 'start_minutes')::integer between 0 and 1439 else false end
        and jsonb_typeof(template_data -> 'service_duration_minutes') = 'number'
        and case when (template_data ->> 'service_duration_minutes') ~ '^[1-9][0-9]{0,2}$'
          then (template_data ->> 'service_duration_minutes')::integer between 1 and 480 else false end
        and jsonb_typeof(template_data -> 'service_name') = 'string'
        and length(btrim(template_data ->> 'service_name')) between 1 and 160
        and jsonb_typeof(template_data -> 'variant_name') = 'string'
        and length(btrim(template_data ->> 'variant_name')) between 1 and 160
        and ((template_kind in ('reschedule_customer', 'reschedule_owner')
          and template_data ?& array['old_local_date', 'old_start_minutes']
          and jsonb_typeof(template_data -> 'old_local_date') = 'string'
          and (template_data ->> 'old_local_date') ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$'
          and jsonb_typeof(template_data -> 'old_start_minutes') = 'number'
          and case when (template_data ->> 'old_start_minutes') ~ '^(0|[1-9][0-9]{0,3})$'
            then (template_data ->> 'old_start_minutes')::integer between 0 and 1439 else false end)
          or (template_kind not in ('reschedule_customer', 'reschedule_owner')
            and not template_data ? 'old_local_date' and not template_data ? 'old_start_minutes'))
      ))
    ) else false end
  );

revoke create on schema gioia_private from gioia_mutator;
revoke all on function gioia_private.complete_email_outbox_pre_provider_failure(
  uuid,integer,text,text,boolean
) from public, anon, authenticated, service_role, app_runtime, gioia_migrator;
grant execute on function gioia_private.complete_email_outbox_pre_provider_failure(
  uuid,integer,text,text,boolean
) to app_runtime;
revoke all on function gioia_private.enforce_newsletter_subscriber_transition()
  from public, anon, authenticated, service_role, app_runtime, gioia_migrator;
grant execute on function gioia_private.enforce_newsletter_subscriber_transition()
  to gioia_mutator;
revoke all on function gioia_private.canonicalize_newsletter_action_token_times()
  from public, anon, authenticated, service_role, app_runtime, gioia_migrator;
grant execute on function gioia_private.canonicalize_newsletter_action_token_times()
  to gioia_mutator;
revoke gioia_mutator from postgres;
commit;

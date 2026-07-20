begin;

set local lock_timeout = '5s';
set local statement_timeout = '30s';

create function gioia_private.enforce_newsletter_action_token_transition()
returns trigger
language plpgsql
security invoker
set search_path = pg_catalog
as $$
begin
  if row(
    old.token_id, old.consent_cycle_id, old.subscriber_id, old.subscriber_version,
    old.issue_sequence, old.token_version, old.purpose, old.signing_key_id,
    old.issued_at, old.expires_at, old.created_at
  ) is distinct from row(
    new.token_id, new.consent_cycle_id, new.subscriber_id, new.subscriber_version,
    new.issue_sequence, new.token_version, new.purpose, new.signing_key_id,
    new.issued_at, new.expires_at, new.created_at
  ) then
    raise exception using errcode = '23514', message = 'Newsletter action token evidence is immutable';
  end if;
  if old.consumed_at is not null
    or (new.consumed_at is null or new.consumed_command_request_id is null) then
    raise exception using errcode = '23514', message = 'Newsletter action token can be consumed exactly once';
  end if;
  return new;
end;
$$;

create or replace function gioia_private.enforce_newsletter_subscriber_transition()
returns trigger
language plpgsql
security invoker
set search_path = pg_catalog
as $$
begin
  if row(
    old.id, old.schema_version, old.email, old.source,
    old.legacy_firestore_id, old.timestamp_provenance, old.imported_at, old.created_at
  ) is distinct from row(
    new.id, new.schema_version, new.email, new.source,
    new.legacy_firestore_id, new.timestamp_provenance, new.imported_at, new.created_at
  ) then
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
    and not (
      (old.status in ('legacy_unverified', 'unsubscribed', 'bounced') and new.status = 'pending')
      or (old.status = 'pending' and new.status = 'pending')
    ) then
    raise exception using errcode = '23514', message = 'Subscriber consent evidence is immutable';
  end if;
  if old.confirmed_at is not null and old.confirmed_at is distinct from new.confirmed_at then
    raise exception using errcode = '23514', message = 'Subscriber confirmation is immutable';
  end if;
  if old.unsubscribed_at is not null
    and old.unsubscribed_at is distinct from new.unsubscribed_at
    and new.status <> 'pending' then
    raise exception using errcode = '23514', message = 'Subscriber unsubscribe evidence is immutable';
  end if;
  return new;
end;
$$;

create or replace function gioia_private.enforce_email_outbox_transition()
returns trigger
language plpgsql
security invoker
set search_path = pg_catalog
as $$
begin
  if row(
    old.id, old.aggregate_kind, old.aggregate_id, old.aggregate_version,
    old.recipient_kind, old.recipient_address, old.template_kind,
    old.template_version, old.template_data, old.newsletter_action_token_id,
    old.idempotency_key, old.created_at
  ) is distinct from row(
    new.id, new.aggregate_kind, new.aggregate_id, new.aggregate_version,
    new.recipient_kind, new.recipient_address, new.template_kind,
    new.template_version, new.template_data, new.newsletter_action_token_id,
    new.idempotency_key, new.created_at
  ) then
    raise exception using errcode = '23514', message = 'Outbox recipient and template snapshots are immutable';
  end if;
  if old.first_provider_attempt_at is not null
    and row(old.first_provider_attempt_at, old.provider_retry_deadline_at)
      is distinct from row(new.first_provider_attempt_at, new.provider_retry_deadline_at) then
    raise exception using errcode = '23514', message = 'Provider retry window is immutable';
  end if;
  if old.provider_message_id is not null
    and old.provider_message_id is distinct from new.provider_message_id then
    raise exception using errcode = '23514', message = 'Provider message identity is immutable';
  end if;
  if old.sent_at is not null and old.sent_at is distinct from new.sent_at then
    raise exception using errcode = '23514', message = 'Outbox sent timestamp is immutable';
  end if;
  if new.attempt_count < old.attempt_count or new.attempt_count > old.attempt_count + 1 then
    raise exception using errcode = '23514', message = 'Outbox attempt count must advance monotonically';
  end if;
  if old.status <> new.status and not (
    (old.status = 'pending' and new.status in ('sending', 'dead_letter'))
    or (old.status = 'sending' and new.status in ('sent', 'failed', 'dead_letter', 'bounced', 'complained'))
    or (old.status = 'failed' and new.status in ('sending', 'sent', 'dead_letter', 'bounced', 'complained'))
    or (old.status = 'dead_letter' and new.status = 'failed')
    or (old.status = 'sent' and new.status in ('bounced', 'complained'))
    or (old.status = 'bounced' and new.status = 'complained')
  ) then
    raise exception using errcode = '23514', message = 'Invalid outbox status transition';
  end if;
  return new;
end;
$$;

create function gioia_private.record_email_dead_letter_event()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if new.status = 'dead_letter' and old.status <> 'dead_letter' then
    insert into gioia_private.email_dead_letter_events (
      outbox_id, outbox_version, reason_code, origin
    ) values (
      new.id, new.version,
      coalesce(new.last_error_code, 'OUTBOX_DEAD_LETTERED'),
      case when new.last_error_code in (
        'AGGREGATE_STATE_STALE', 'LEASE_ATTEMPTS_EXHAUSTED',
        'PROVIDER_RETRY_WINDOW_EXPIRED', 'NEWSLETTER_ACTION_EXPIRED',
        'NEWSLETTER_ACTION_LIFETIME_TOO_SHORT'
      ) then 'claim' else 'completion' end
    ) on conflict (outbox_id, outbox_version) do nothing;
  end if;
  return null;
end;
$$;

create trigger newsletter_action_tokens_state_guard
before update on gioia_private.newsletter_action_tokens
for each row execute function gioia_private.enforce_newsletter_action_token_transition();
create trigger email_outbox_dead_letter_event
after update on gioia_private.email_outbox
for each row execute function gioia_private.record_email_dead_letter_event();


commit;

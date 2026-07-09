begin;

set local lock_timeout = '5s';
set local statement_timeout = '30s';

create or replace function gioia_private.enforce_newsletter_subscriber_transition()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if row(
    old.id, old.schema_version, old.email, old.source,
    old.legacy_firestore_id, old.timestamp_provenance,
    old.imported_at, old.created_at
  ) is distinct from row(
    new.id, new.schema_version, new.email, new.source,
    new.legacy_firestore_id, new.timestamp_provenance,
    new.imported_at, new.created_at
  ) then
    raise exception using errcode = '23514',
      message = 'Subscriber identity and provenance are immutable';
  end if;

  if old.status <> new.status and not (
    (old.status = 'legacy_unverified' and new.status in ('pending', 'unsubscribed'))
    or (old.status = 'pending' and new.status in (
      'active', 'unsubscribed', 'bounced', 'complained'
    ))
    or (old.status = 'active' and new.status in (
      'unsubscribed', 'bounced', 'complained'
    ))
    or (old.status = 'unsubscribed' and new.status = 'pending')
    or (old.status = 'bounced' and new.status in (
      'pending', 'unsubscribed', 'complained'
    ))
  ) then
    raise exception using errcode = '23514',
      message = 'Invalid subscriber status transition';
  end if;

  if row(old.consent_at, old.consent_source, old.consent_policy_version)
    is distinct from row(new.consent_at, new.consent_source, new.consent_policy_version)
    and not (old.status in ('legacy_unverified', 'unsubscribed', 'bounced')
      and new.status = 'pending') then
    raise exception using errcode = '23514',
      message = 'Subscriber consent evidence is immutable';
  end if;

  if old.confirmed_at is distinct from new.confirmed_at and not (
    (old.status = 'pending' and new.status = 'active'
      and old.confirmed_at is null and new.confirmed_at is not null)
    or (old.status in ('unsubscribed', 'bounced') and new.status = 'pending'
      and new.confirmed_at is null)
  ) then
    raise exception using errcode = '23514',
      message = 'Subscriber confirmation change is invalid';
  end if;

  if old.unsubscribed_at is not null
    and old.unsubscribed_at is distinct from new.unsubscribed_at
    and new.status <> 'pending' then
    raise exception using errcode = '23514',
      message = 'Subscriber unsubscribe evidence is immutable';
  end if;

  return new;
end;
$$;

create or replace function gioia_private.enforce_email_outbox_transition()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if row(
    old.id, old.aggregate_kind, old.aggregate_id, old.aggregate_version,
    old.recipient_kind, old.recipient_address, old.template_kind,
    old.template_data, old.idempotency_key, old.created_at
  ) is distinct from row(
    new.id, new.aggregate_kind, new.aggregate_id, new.aggregate_version,
    new.recipient_kind, new.recipient_address, new.template_kind,
    new.template_data, new.idempotency_key, new.created_at
  ) then
    raise exception using errcode = '23514',
      message = 'Outbox recipient and template snapshots are immutable';
  end if;

  if old.provider_message_id is not null
    and old.provider_message_id is distinct from new.provider_message_id then
    raise exception using errcode = '23514',
      message = 'Provider message identity is immutable';
  end if;
  if old.sent_at is not null and old.sent_at is distinct from new.sent_at then
    raise exception using errcode = '23514',
      message = 'Outbox sent timestamp is immutable';
  end if;
  if new.attempt_count < old.attempt_count
    or new.attempt_count > old.attempt_count + 1 then
    raise exception using errcode = '23514',
      message = 'Outbox attempt count must advance monotonically';
  end if;

  if old.status <> new.status and not (
    (old.status = 'pending' and new.status in ('sending', 'dead_letter'))
    or (old.status = 'sending' and new.status in (
      'sent', 'failed', 'dead_letter', 'bounced', 'complained'
    ))
    or (old.status = 'failed' and new.status in (
      'sending', 'sent', 'dead_letter', 'bounced', 'complained'
    ))
    or (old.status = 'dead_letter' and new.status = 'failed')
    or (old.status = 'sent' and new.status in ('bounced', 'complained'))
    or (old.status = 'bounced' and new.status = 'complained')
  ) then
    raise exception using errcode = '23514',
      message = 'Invalid outbox status transition';
  end if;

  return new;
end;
$$;

revoke all on function gioia_private.enforce_newsletter_subscriber_transition()
  from public, anon, authenticated, service_role, app_runtime, gioia_migrator;
revoke all on function gioia_private.enforce_email_outbox_transition()
  from public, anon, authenticated, service_role, app_runtime, gioia_migrator;
grant execute on function gioia_private.enforce_newsletter_subscriber_transition()
  to gioia_mutator;
grant execute on function gioia_private.enforce_email_outbox_transition()
  to gioia_mutator;

commit;

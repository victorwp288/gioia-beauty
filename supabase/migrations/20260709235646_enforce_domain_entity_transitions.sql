begin;

set local lock_timeout = '5s';
set local statement_timeout = '30s';

create function gioia_private.enforce_schedule_entry_transition()
returns trigger
language plpgsql
security invoker
set search_path = pg_catalog
as $$
begin
  if row(
    old.id, old.schema_version, old.kind, old.source, old.legacy_firestore_id,
    old.timestamp_provenance, old.imported_at, old.created_at
  ) is distinct from row(
    new.id, new.schema_version, new.kind, new.source, new.legacy_firestore_id,
    new.timestamp_provenance, new.imported_at, new.created_at
  ) then
    raise exception using errcode = '23514', message = 'Schedule identity and provenance are immutable';
  end if;

  if old.status <> new.status and not (
    (old.kind = 'appointment' and old.status = 'confirmed'
      and new.status in ('completed', 'cancelled', 'no_show'))
    or (old.kind = 'block' and old.status = 'active' and new.status = 'cancelled')
  ) then
    raise exception using errcode = '23514', message = 'Invalid schedule status transition';
  end if;

  if old.status in ('completed', 'cancelled', 'no_show')
    and (
      to_jsonb(old) - array['version', 'updated_at', 'created_by']
      is distinct from
      to_jsonb(new) - array['version', 'updated_at', 'created_by']
    ) then
    raise exception using errcode = '23514', message = 'Terminal schedule entries are immutable';
  end if;

  return new;
end;
$$;

create function gioia_private.enforce_vacation_transition()
returns trigger
language plpgsql
security invoker
set search_path = pg_catalog
as $$
begin
  if row(
    old.id, old.schema_version, old.source, old.legacy_firestore_id,
    old.timestamp_provenance, old.imported_at, old.created_at
  ) is distinct from row(
    new.id, new.schema_version, new.source, new.legacy_firestore_id,
    new.timestamp_provenance, new.imported_at, new.created_at
  ) then
    raise exception using errcode = '23514', message = 'Vacation identity and provenance are immutable';
  end if;

  if old.status <> new.status
    and not (old.status = 'active' and new.status = 'cancelled') then
    raise exception using errcode = '23514', message = 'Invalid vacation status transition';
  end if;

  if old.status = 'cancelled'
    and (
      to_jsonb(old) - array['version', 'updated_at', 'created_by', 'cancelled_by']
      is distinct from
      to_jsonb(new) - array['version', 'updated_at', 'created_by', 'cancelled_by']
    ) then
    raise exception using errcode = '23514', message = 'Cancelled vacations are immutable';
  end if;

  return new;
end;
$$;

create function gioia_private.enforce_email_webhook_event_transition()
returns trigger
language plpgsql
security invoker
set search_path = pg_catalog
as $$
begin
  if row(
    old.provider_event_id, old.provider_message_id, old.event_kind,
    old.payload_sha256, old.signature_verified, old.received_at
  ) is distinct from row(
    new.provider_event_id, new.provider_message_id, new.event_kind,
    new.payload_sha256, new.signature_verified, new.received_at
  ) then
    raise exception using errcode = '23514', message = 'Webhook evidence is immutable';
  end if;

  if old.processed_at is not null then
    raise exception using errcode = '23514', message = 'Processed webhook events are immutable';
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
    old.legacy_firestore_id, old.timestamp_provenance,
    old.imported_at, old.created_at
  ) is distinct from row(
    new.id, new.schema_version, new.email, new.source,
    new.legacy_firestore_id, new.timestamp_provenance,
    new.imported_at, new.created_at
  ) then
    raise exception using errcode = '23514', message = 'Subscriber identity and provenance are immutable';
  end if;

  if old.status <> new.status and not (
    (old.status = 'legacy_unverified' and new.status in ('pending', 'unsubscribed'))
    or (old.status = 'pending' and new.status in (
      'active', 'unsubscribed', 'bounced', 'complained'
    ))
    or (old.status = 'active' and new.status in ('unsubscribed', 'bounced', 'complained'))
    or (old.status = 'unsubscribed' and new.status = 'pending')
    or (old.status = 'bounced' and new.status in ('pending', 'unsubscribed', 'complained'))
  ) then
    raise exception using errcode = '23514', message = 'Invalid subscriber status transition';
  end if;

  if row(old.consent_at, old.consent_source, old.consent_policy_version)
    is distinct from row(new.consent_at, new.consent_source, new.consent_policy_version)
    and not (old.status in ('legacy_unverified', 'unsubscribed', 'bounced')
      and new.status = 'pending') then
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

revoke all on function gioia_private.enforce_schedule_entry_transition()
  from public, anon, authenticated, service_role, app_runtime, gioia_migrator;
revoke all on function gioia_private.enforce_vacation_transition()
  from public, anon, authenticated, service_role, app_runtime, gioia_migrator;
revoke all on function gioia_private.enforce_email_webhook_event_transition()
  from public, anon, authenticated, service_role, app_runtime, gioia_migrator;
revoke all on function gioia_private.enforce_newsletter_subscriber_transition()
  from public, anon, authenticated, service_role, app_runtime, gioia_migrator;
grant execute on function gioia_private.enforce_schedule_entry_transition()
  to gioia_mutator;
grant execute on function gioia_private.enforce_vacation_transition()
  to gioia_mutator;
grant execute on function gioia_private.enforce_email_webhook_event_transition()
  to gioia_mutator;
grant execute on function gioia_private.enforce_newsletter_subscriber_transition()
  to gioia_mutator;

create trigger schedule_entries_state_guard
before update on gioia_private.schedule_entries
for each row execute function gioia_private.enforce_schedule_entry_transition();
create trigger vacations_state_guard
before update on gioia_private.vacations
for each row execute function gioia_private.enforce_vacation_transition();
create trigger email_webhook_events_state_guard
before update on gioia_private.email_webhook_events
for each row execute function gioia_private.enforce_email_webhook_event_transition();

revoke update, delete on table gioia_private.migration_records from gioia_migrator;
revoke delete on table
  gioia_private.migration_runs,
  gioia_private.migration_quarantine
from gioia_migrator;

commit;

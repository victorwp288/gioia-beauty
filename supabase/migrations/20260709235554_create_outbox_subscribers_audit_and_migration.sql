begin;

set local lock_timeout = '5s';
set local statement_timeout = '30s';

create table gioia_private.newsletter_subscribers (
  id uuid primary key default extensions.gen_random_uuid(),
  schema_version smallint not null default 1,
  email extensions.citext not null unique,
  status text not null,
  source text not null,
  consent_at timestamptz,
  consent_source text,
  consent_policy_version text,
  confirmed_at timestamptz,
  unsubscribed_at timestamptz,
  legacy_firestore_id text unique,
  timestamp_provenance text not null default 'source',
  imported_at timestamptz,
  version integer not null default 1,
  created_at timestamptz not null default statement_timestamp(),
  updated_at timestamptz not null default statement_timestamp(),
  constraint newsletter_subscribers_schema_version_current check (schema_version = 1),
  constraint newsletter_subscribers_email_normalized check (
    email::text = lower(btrim(email::text))
    and length(email::text) between 3 and 320
  ),
  constraint newsletter_subscribers_status_known check (
    status in ('legacy_unverified', 'pending', 'active', 'unsubscribed', 'bounced', 'complained')
  ),
  constraint newsletter_subscribers_source_known
    check (source in ('public', 'admin', 'migration')),
  constraint newsletter_subscribers_consent_consistent check (
    (status in ('pending', 'active', 'bounced', 'complained')
      and consent_at is not null
      and consent_source is not null
      and consent_policy_version is not null
      and length(btrim(consent_source)) between 1 and 100
      and length(btrim(consent_policy_version)) between 1 and 100)
    or (status not in ('pending', 'active', 'bounced', 'complained'))
  ),
  constraint newsletter_subscribers_confirmation_consistent check (
    (status = 'active' and confirmed_at is not null)
    or (status <> 'active')
  ),
  constraint newsletter_subscribers_unsubscribe_consistent check (
    (status = 'unsubscribed' and unsubscribed_at is not null)
    or (status <> 'unsubscribed' and unsubscribed_at is null)
  ),
  constraint newsletter_subscribers_legacy_unverified_shape check (
    status <> 'legacy_unverified'
    or (source = 'migration' and consent_at is null and consent_source is null
      and consent_policy_version is null and confirmed_at is null and unsubscribed_at is null)
  ),
  constraint newsletter_subscribers_legacy_id_bound
    check (legacy_firestore_id is null or octet_length(legacy_firestore_id) between 1 and 1500),
  constraint newsletter_subscribers_timestamp_provenance_known
    check (timestamp_provenance in ('source', 'import_time')),
  constraint newsletter_subscribers_import_consistent check (
    (source = 'migration' and imported_at is not null and legacy_firestore_id is not null)
    or (source in ('public', 'admin') and imported_at is null and legacy_firestore_id is null)
  ),
  constraint newsletter_subscribers_version_positive check (version > 0)
);

create index newsletter_subscribers_status_created_idx
  on gioia_private.newsletter_subscribers (status, created_at desc, id);

create table gioia_private.email_outbox (
  id uuid primary key default extensions.gen_random_uuid(),
  aggregate_kind text not null,
  aggregate_id uuid not null,
  aggregate_version integer not null,
  recipient_kind text not null,
  recipient_address extensions.citext not null,
  template_kind text not null,
  template_data jsonb not null,
  idempotency_key text not null unique,
  status text not null default 'pending',
  provider_message_id text,
  attempt_count smallint not null default 0,
  next_attempt_at timestamptz not null default statement_timestamp(),
  locked_at timestamptz,
  locked_by text,
  lease_expires_at timestamptz,
  last_error_code text,
  sent_at timestamptz,
  version integer not null default 1,
  created_at timestamptz not null default statement_timestamp(),
  updated_at timestamptz not null default statement_timestamp(),
  constraint email_outbox_aggregate_kind_known
    check (aggregate_kind in ('schedule_entry', 'subscriber')),
  constraint email_outbox_aggregate_version_positive check (aggregate_version > 0),
  constraint email_outbox_recipient_kind_known
    check (recipient_kind in ('customer', 'owner', 'subscriber')),
  constraint email_outbox_address_normalized check (
    recipient_address::text = lower(btrim(recipient_address::text))
    and length(recipient_address::text) between 3 and 320
  ),
  constraint email_outbox_template_kind_known check (
    template_kind in (
      'booking_customer', 'booking_owner', 'cancellation_customer',
      'cancellation_owner', 'reschedule_customer', 'reschedule_owner',
      'newsletter_confirmation'
    )
  ),
  constraint email_outbox_snapshot_compatible check (
    (aggregate_kind = 'schedule_entry' and (
      (recipient_kind = 'customer' and template_kind in (
        'booking_customer', 'cancellation_customer', 'reschedule_customer'
      ))
      or (recipient_kind = 'owner' and template_kind in (
        'booking_owner', 'cancellation_owner', 'reschedule_owner'
      ))
    ))
    or (aggregate_kind = 'subscriber' and recipient_kind = 'subscriber'
      and template_kind = 'newsletter_confirmation')
  ),
  constraint email_outbox_template_data_bounded check (
    jsonb_typeof(template_data) = 'object'
    and octet_length(template_data::text) between 2 and 16384
  ),
  constraint email_outbox_idempotency_key_bound
    check (octet_length(idempotency_key) between 8 and 255
      and idempotency_key ~ '^[A-Za-z0-9._:-]{8,255}$'),
  constraint email_outbox_status_known check (
    status in ('pending', 'sending', 'sent', 'failed', 'dead_letter', 'bounced', 'complained')
  ),
  constraint email_outbox_provider_id_bound
    check (provider_message_id is null or octet_length(provider_message_id) between 1 and 255),
  constraint email_outbox_attempt_bound check (attempt_count between 0 and 20),
  constraint email_outbox_lock_consistent check (
    (status = 'sending'
      and locked_at is not null
      and locked_by is not null
      and lease_expires_at is not null
      and length(btrim(locked_by)) between 1 and 100
      and lease_expires_at > locked_at)
    or (status <> 'sending' and locked_at is null and locked_by is null and lease_expires_at is null)
  ),
  constraint email_outbox_error_code_format
    check (last_error_code is null or last_error_code ~ '^[A-Z][A-Z0-9_]{1,63}$'),
  constraint email_outbox_delivery_state_consistent check (
    (status = 'pending' and attempt_count = 0 and provider_message_id is null
      and last_error_code is null and sent_at is null)
    or (status = 'sending' and attempt_count > 0 and provider_message_id is null
      and last_error_code is null and sent_at is null)
    or (status in ('failed', 'dead_letter') and attempt_count > 0
      and provider_message_id is null and last_error_code is not null and sent_at is null)
    or (status = 'sent' and attempt_count > 0 and provider_message_id is not null
      and last_error_code is null and sent_at is not null)
    or (status in ('bounced', 'complained') and attempt_count > 0
      and provider_message_id is not null and last_error_code is not null and sent_at is not null)
  ),
  constraint email_outbox_version_positive check (version > 0)
);

create unique index email_outbox_provider_message_unique_idx
  on gioia_private.email_outbox (provider_message_id)
  where provider_message_id is not null;
create index email_outbox_claim_idx
  on gioia_private.email_outbox (next_attempt_at, created_at, id)
  where status in ('pending', 'failed');
create index email_outbox_expired_lease_idx
  on gioia_private.email_outbox (lease_expires_at, id)
  where status = 'sending';

create table gioia_private.email_webhook_events (
  provider_event_id text primary key,
  provider_message_id text,
  event_kind text not null,
  payload_sha256 bytea not null,
  signature_verified boolean not null,
  received_at timestamptz not null default statement_timestamp(),
  processed_at timestamptz,
  processing_error_code text,
  constraint email_webhook_events_id_bound
    check (length(provider_event_id) between 1 and 255),
  constraint email_webhook_events_message_id_bound
    check (provider_message_id is null or length(provider_message_id) between 1 and 255),
  constraint email_webhook_events_kind_known
    check (event_kind in ('delivered', 'bounced', 'complained', 'other')),
  constraint email_webhook_events_payload_sha256
    check (octet_length(payload_sha256) = 32),
  constraint email_webhook_events_signature_required check (signature_verified),
  constraint email_webhook_events_error_code_format check (
    processing_error_code is null or processing_error_code ~ '^[A-Z][A-Z0-9_]{1,63}$'
  ),
  constraint email_webhook_events_processing_consistent check (
    processed_at is null or processing_error_code is null
  )
);

create index email_webhook_events_unprocessed_idx
  on gioia_private.email_webhook_events (received_at, provider_event_id)
  where processed_at is null;
create index email_webhook_events_provider_message_idx
  on gioia_private.email_webhook_events (provider_message_id, received_at)
  where provider_message_id is not null;

create table gioia_private.domain_change_log (
  sequence_id bigint generated always as identity primary key,
  aggregate_kind text not null,
  aggregate_id uuid not null,
  aggregate_version integer not null,
  change_kind text not null,
  schema_version smallint not null default 1,
  source text not null,
  command_request_id uuid,
  migration_run_id uuid,
  actor_user_id uuid references auth.users(id) on update restrict on delete restrict,
  changed_fields text[] not null,
  changed_at timestamptz not null default statement_timestamp(),
  constraint domain_change_log_aggregate_kind_known
    check (aggregate_kind in ('schedule_entry', 'vacation', 'subscriber')),
  constraint domain_change_log_aggregate_version_positive check (aggregate_version > 0),
  constraint domain_change_log_change_kind_known check (
    change_kind in ('create', 'update', 'reschedule', 'cancel', 'block', 'subscribe', 'unsubscribe')
  ),
  constraint domain_change_log_schema_version_current check (schema_version = 1),
  constraint domain_change_log_source_known
    check (source in ('public', 'admin', 'migration', 'system')),
  constraint domain_change_log_changed_fields_safe check (
    cardinality(changed_fields) between 1 and 32
    and array_position(changed_fields, null::text) is null
    and array_to_string(changed_fields, ',')
      ~ '^[a-z][a-z0-9_]{0,62}(,[a-z][a-z0-9_]{0,62})*$'
  ),
  constraint domain_change_log_source_consistent check (
    (source = 'public' and command_request_id is not null
      and migration_run_id is null and actor_user_id is null)
    or (source = 'admin' and command_request_id is not null
      and migration_run_id is null and actor_user_id is not null)
    or (source = 'migration' and command_request_id is null
      and migration_run_id is not null and actor_user_id is null)
    or (source = 'system' and migration_run_id is null and actor_user_id is null)
  )
);

create index domain_change_log_aggregate_idx
  on gioia_private.domain_change_log (aggregate_kind, aggregate_id, sequence_id);

alter table gioia_private.newsletter_subscribers enable row level security;
alter table gioia_private.newsletter_subscribers force row level security;
alter table gioia_private.email_outbox enable row level security;
alter table gioia_private.email_outbox force row level security;
alter table gioia_private.email_webhook_events enable row level security;
alter table gioia_private.email_webhook_events force row level security;
alter table gioia_private.domain_change_log enable row level security;
alter table gioia_private.domain_change_log force row level security;

create policy newsletter_subscribers_mutator_all on gioia_private.newsletter_subscribers
  for all to gioia_mutator using (true) with check (true);
create policy email_outbox_mutator_all on gioia_private.email_outbox
  for all to gioia_mutator using (true) with check (true);
create policy email_webhook_events_mutator_all on gioia_private.email_webhook_events
  for all to gioia_mutator using (true) with check (true);
create policy domain_change_log_mutator_insert on gioia_private.domain_change_log
  for insert to gioia_mutator with check (true);
create policy domain_change_log_mutator_select on gioia_private.domain_change_log
  for select to gioia_mutator using (true);
grant select, insert, update on table
  gioia_private.newsletter_subscribers,
  gioia_private.email_outbox,
  gioia_private.email_webhook_events
to gioia_mutator;
grant select, insert on table gioia_private.domain_change_log to gioia_mutator;
grant usage, select on all sequences in schema gioia_private to gioia_mutator;

create trigger newsletter_subscribers_touch
before update on gioia_private.newsletter_subscribers
for each row execute function gioia_private.set_updated_at_and_version();
create trigger email_outbox_touch
before update on gioia_private.email_outbox
for each row execute function gioia_private.set_updated_at_and_version();

revoke all on all tables in schema gioia_private
  from public, anon, authenticated, service_role, app_runtime;
revoke all on all sequences in schema gioia_private
  from public, anon, authenticated, service_role, app_runtime;

commit;

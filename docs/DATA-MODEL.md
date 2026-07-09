# Data model — Firestore source, Supabase target, and one-time transition

Required reading before appointment, migration, availability, auth, export, or retention work. Production procedures are governed by `docs/PRODUCTION-SAFETY.md`.

## 1. Source: legacy Firestore

Collection `customers` holds appointments and time blocks. A representative document:

```jsonc
{
  "name": "Maria Rossi",
  "email": "maria.rossi@gmail.com",        // may be ""
  "number": "+39 333 1234567",
  "appointmentType": "Manicure",          // mutable display label
  "variant": "60",                         // active public path may store a duration string; legacy values vary
  "selectedDate": /* one of THREE at-rest formats below */,
  "startTime": "14:30",
  "endTime": "15:20",                     // computed by divergent client implementations
  "duration": 45,
  "totalDuration": 50,
  "note": "",
  "status": "confirmed",                  // missing on old records
  "isTimeBlock": false,                    // newer blocks only
  "createdAt": "2025-11-03T09:12:44.120Z", // ISO string; missing on old records
  "updatedAt": "2025-11-03T09:12:44.120Z"
}
```

### Date representations

| # | Representation | Example | At rest? |
|---|---|---|---|
| 1 | Date-only string | `"2024-06-14"` | Yes |
| 2 | Full ISO string | `"2025-03-14T00:00:00.000Z"` | Yes |
| 3 | Firestore Timestamp | `Timestamp(...)` | Yes |
| 4 | JavaScript `Date` | `Date Fri Mar 14 ...` | **No; memory/cache representation only** |

Migration rules:

- Date-only and ISO strings represent an intended Europe/Rome calendar day. For ISO legacy values, preserve the date component rather than shifting it through the machine timezone.
- Timestamp meaning must be checked against real fixtures; do not assume UTC midnight equals the intended Rome day.
- Current Timestamp-only queries can miss string-date records before normalization. A staging/source inventory must scan all source records rather than trusting current application queries.
- Missing `status` defaults to `confirmed` only when the record is otherwise a valid appointment/block.
- Blocks can lack meaningful name/email/phone and may be identified by `isTimeBlock`, `appointmentType`, name, or other legacy combinations. Mapping rules use fixtures and report unknowns.
- Do not trust legacy `endTime`, `totalDuration`, `variant`, or `updatedAt`. Recompute/derive only through an explicit mapping and quarantine ambiguous records.
- No migration script may log names, emails, phone numbers, or notes.

Other Firestore collections:

- `vacations`: loose `{ startDate, endDate, reason }` representations.
- `newsletter_subscribers`: multiple field/status shapes and potentially duplicate normalized emails.
- `settings` / `analytics`: inventory before cutover; migrate only if an actual live consumer is proven.

## 2. Target: Supabase Postgres

The exact SQL is defined by reviewed migrations. Zod schemas validate application boundaries; PostgreSQL constraints remain the final persistence authority.

### `service_categories`

```text
id                  text primary key
name_it             text not null
sort_order          integer not null
active              boolean not null
```

### `services`

```text
id                  text primary key       -- explicit stable ID, never derived at runtime from display text
name_it             text not null
category_id         text not null references service_categories(id)
active              boolean not null
created_at          timestamptz not null
updated_at          timestamptz not null
```

### `service_variants`

```text
id                       text primary key
service_id               text not null references services(id)
name_it                  text not null
service_duration_minutes integer not null
buffer_minutes           integer not null
price_cents              integer null      -- null until verified real price data exists
currency                 text null
active                   boolean not null
unique (service_id, id)
```

The versioned repository catalog manifest is the only authoring source. Reviewed migrations/seeds populate the relational catalog, public content is generated from the same manifest, and a drift test proves the manifest and database agree. At runtime, the database is authoritative for booking rules. There is no invented fallback price. If verified prices are introduced, bookings snapshot both cents and currency.

### `schedule_entries`

One table holds appointments and owner-created blocks so one database invariant can protect the occupied schedule.

```text
id                         uuid primary key
schema_version             integer not null
kind                       appointment | block
status                     confirmed | completed | cancelled | no_show | active
date                       date not null                -- salon-local Europe/Rome calendar date
start_minutes              integer not null             -- 0..1439
service_duration_minutes   integer not null
buffer_minutes             integer not null
occupied_minutes           integer generated/validated  -- service + buffer
service_id                 text null
variant_id                 text null
service_name_snapshot      text null
variant_name_snapshot      text null
price_cents_snapshot       integer null
currency_snapshot          text null
source                     public | admin | migration
client_name                text null
client_email               text null                     -- normalized address or null, never empty
client_phone               text null
client_note                text null
internal_note              text null
idempotency_key            text null
idempotency_operation      text null
idempotency_principal      text null
request_fingerprint        text null
legacy_firestore_id        text null unique
cancelled_at               timestamptz null
cancelled_by               client | admin | system | null
cancellation_reason        text null
created_at                 timestamptz not null
updated_at                 timestamptz not null
timestamp_provenance       source | import_time
imported_at                timestamptz null
unique (idempotency_operation, idempotency_principal, idempotency_key)
foreign key (service_id, variant_id) references service_variants(service_id, id)
```

Structural checks enforce:

- appointments require a matching service/variant pair, client name, and status in `confirmed | completed | cancelled | no_show`; email/phone optionality follows the separately approved public/admin schemas;
- blocks have no client/service requirement, use owner-visible block notes, and status only in `active | cancelled`;
- `start_minutes`, durations, and occupied end remain within the calendar day/business override rules;
- cancelled entries do not consume availability;
- active appointment/block intervals on the same date cannot overlap;
- identical idempotent retries return the original result; reuse of the same operation/principal/key with a different request fingerprint returns 409 rather than inserting or reusing the wrong booking.

Use a Postgres exclusion constraint over an integer range, or a single reviewed transactional database function with equivalent protection. Pure TypeScript availability is not the final conflict authority.

### `vacations`

```text
id                    uuid primary key
schema_version        integer not null
start_date            date not null
end_date              date not null
reason                text null
created_by            uuid null references auth.users(id) on delete set null
source                admin | migration
legacy_firestore_id   text null unique
created_at            timestamptz not null
updated_at            timestamptz not null
timestamp_provenance  source | import_time
imported_at           timestamptz null
```

For migrated vacations, `created_by` is nullable and `source = migration`; the importer never invents an owner UUID. New admin-created rows require the authenticated owner ID. The product decision for a vacation overlapping existing bookings must be explicit: reject, warn-and-confirm, or allow with an owner workflow. Vacation creation and booking creation must share a locking/invariant strategy so concurrent operations cannot slip past each other.

### `newsletter_subscribers`

```text
id                     uuid primary key
schema_version         integer not null
email                  citext not null unique
status                 legacy_unverified | pending | active | unsubscribed | bounced | complained
source                 public | admin | migration
legacy_firestore_id    text null unique
consent_at             timestamptz null
consent_source         text null
consent_policy_version text null
confirmed_at           timestamptz null
unsubscribed_at        timestamptz null
created_at             timestamptz not null
updated_at             timestamptz not null
timestamp_provenance   source | import_time
imported_at             timestamptz null
```

The `citext` extension plus a database check requiring `email = btrim(email)` enforce canonical case-insensitive uniqueness; normalization is not a caller-controlled second column. Legacy rows without provable consent become `legacy_unverified` with null consent provenance and are not marketed to until reconfirmed or owner/legal review establishes a documented basis. Public subscribe/unsubscribe responses do not reveal whether an address exists. Unsubscribe uses a signed, expiring/single-purpose token; an arbitrary email address is not authorization.

### `email_outbox`

```text
id                  uuid primary key
aggregate_kind      schedule_entry | subscriber
aggregate_id        uuid not null
recipient_kind      customer | admin | subscriber
recipient_address   citext not null
template_kind       booking | cancellation | reschedule | newsletter_confirmation
template_data       jsonb not null       -- immutable minimal render snapshot
idempotency_key    text not null unique
status             pending | sending | sent | failed | bounced | complained
provider_message_id text null
attempt_count      integer not null
next_attempt_at    timestamptz null
locked_at           timestamptz null
locked_by           text null
lease_expires_at    timestamptz null
last_error_code    text null
created_at         timestamptz not null
updated_at         timestamptz not null
```

Outbox rows and the booking/status/subscriber change commit together. Provider calls happen after commit. A signed Vercel Cron worker claims bounded batches with a database lease/`FOR UPDATE SKIP LOCKED`; expired leases are recoverable, provider idempotency prevents duplicate sends where supported, and dead letters alert the operator. Signed Resend webhooks are replay-deduplicated by provider event ID before state changes. Recipient/template snapshots are encrypted/retained only as long as delivery and audit require. Reports/errors contain identifiers and codes, not PII payloads.

### `email_webhook_events`

```text
provider_event_id   text primary key
provider_message_id text null
event_kind          delivered | bounced | complained | other
received_at         timestamptz not null
processed_at        timestamptz null
```

### `domain_change_log`

```text
sequence_id          bigint generated always as identity primary key
entity_type          schedule_entry | vacation | subscriber
entity_id            uuid not null
action               create | update | reschedule | cancel | block | subscribe | unsubscribe
entity_version       integer not null
request_id           text null
actor_kind           public | admin | migration | system
changed_fields       text[] not null              -- names only; no PII values
occurred_at          timestamptz not null
```

This append-only, PII-minimized sequence provides an auditable high-water mark for rollback/reverse-sync. It does not replace database backups. Mutation functions write the domain row and change-log entry atomically.

### Auth and authorization

- Supabase Auth contains the single owner/admin identity; invite/reset rather than attempting to migrate Firebase password hashes.
- Authorization uses owner-controlled `app_metadata` or an explicit server-side allowlist. Never authorize from editable `user_metadata`.
- Business operations remain behind server routes using a least-privilege pooled `app_runtime` Postgres role against a private schema. `anon`/`authenticated` have no business-table grants; RLS/Data API denial protects browser exposure but does not constrain a privileged service secret.

## 3. Business rules that must be decided before implementation

- Minimum lead time: no same-day booking or an hour-based rule—one canonical rule only.
- Maximum advance window.
- Slot alignment increment.
- Whether buffers belong after the service only and whether they are customer-visible.
- Which admin overrides are allowed for hours, vacations, lead time, and conflicts.
- Whether a vacation can overlap existing confirmed appointments.
- Persisted versus derived `completed` semantics.
- Retention/anonymization periods for customer details, notes, newsletter consent, logs, and backups.
- Whether notes may contain health/sensitive data; the UI should discourage collection that is not necessary.

## 4. One-time ETL rules

The production source remains unchanged throughout development and rehearsals.

1. Export Firestore read-only after exact target verification.
2. Store the raw source encrypted outside git.
3. Transform into local/staging using deterministic mapping tables for service/variant/block values.
4. Preserve every source document ID in `legacy_firestore_id`.
5. Upsert idempotently; rerunning the same source cannot duplicate rows.
6. Quarantine malformed/ambiguous records with a reason code and source ID; never guess or silently omit.
7. Emit redacted aggregate reports only.
8. Test all known source date/status/block/variant shapes and missing fields.
9. Preserve timestamp provenance. Trustworthy source timestamps may be copied; otherwise set operational `created_at`/`updated_at` to import time and record `timestamp_provenance = import_time` rather than pretending it is the original event time.
10. Reconcile before any cutover.

Because `updatedAt` is missing or unreliable on legacy rows, production cutover uses a short write freeze and a final full idempotent import—not a guessed timestamp delta and not long-lived dual writes.

## 5. Required reconciliation

Before switching production, prove:

```text
source Firestore IDs = imported legacy_firestore_ids + explicitly reviewed quarantine IDs
```

Compare at minimum:

- total appointment/block IDs;
- appointment versus block counts;
- counts by status;
- every future confirmed appointment;
- dates, start times, service duration, buffer, and occupied end;
- vacations and inclusive boundaries;
- subscriber normalized uniqueness and statuses;
- unknown service/variant mappings;
- duplicate/overlapping active intervals;
- missing/invalid client fields;
- created/cancelled timestamps where trustworthy;
- source and target checksum/report hashes.

Any unexplained mismatch, overwrite, dropped future appointment, or active overlap is a stop condition.

## 6. Cutover and failure recovery

1. Rehearse the exact process from a restored snapshot.
2. Freeze production booking/dashboard writes.
3. Take the final named Firestore backup/export and reconciliation baseline.
4. Import, rerun for idempotency, and reconcile.
5. Switch production configuration to Supabase.
6. Smoke-test while still frozen.
7. Reopen only after all checks pass.
8. Keep Firestore read-only as a recovery source for 30 days.
9. Reverse ETL is implemented and rehearsed before cutover: imported rows update their original Firestore IDs; Supabase-created rows use deterministic Firestore IDs and retain `supabase_id`; stable service/variant values map back to legacy labels/durations; the change-log high-water mark selects all creates and mutations; reruns are idempotent.
10. If failure occurs before writes reopen, keep maintenance and Firestore deny-write rules active, reverse canary mutations if necessary, and fix forward or restore Supabase.
11. If failure occurs after writes reopen, freeze every Supabase write path, capture the high-water mark, restore/fix forward, and reconcile new/edited/rescheduled/cancelled appointments, blocks, vacations, and subscriber changes before reopening. Reverse ETL preserves an emergency copy; the insecure direct-client Firestore app is not reactivated.

Do not delete Firestore data, legacy exports, or migration tooling during the 30-day window. Destructive retirement is a separate approval after a successful restore drill.

begin;

set local lock_timeout = '5s';
set local statement_timeout = '30s';

alter table gioia_private.service_variants
  add constraint service_variants_service_id_id_unique unique (service_id, id);

create table gioia_private.owner_accounts (
  user_id uuid primary key references auth.users(id) on update restrict on delete restrict,
  role text not null default 'owner',
  enabled boolean not null default true,
  version integer not null default 1,
  created_at timestamptz not null default statement_timestamp(),
  updated_at timestamptz not null default statement_timestamp(),
  constraint owner_accounts_role_owner_only check (role = 'owner'),
  constraint owner_accounts_version_positive check (version > 0)
);

create table gioia_private.command_requests (
  id uuid primary key default extensions.gen_random_uuid(),
  operation text not null,
  principal_scope_hash bytea not null,
  principal_scope_algorithm_version smallint not null default 1,
  idempotency_key text not null,
  request_fingerprint bytea not null,
  request_fingerprint_algorithm_version smallint not null default 1,
  state text not null default 'in_progress',
  resource_kind text,
  resource_id uuid,
  http_status smallint,
  error_code text,
  response_snapshot jsonb,
  expires_at timestamptz not null,
  created_at timestamptz not null default statement_timestamp(),
  completed_at timestamptz,
  constraint command_requests_operation_format
    check (operation ~ '^[a-z][a-z0-9_]{1,63}$'),
  constraint command_requests_principal_hash_sha256
    check (octet_length(principal_scope_hash) = 32),
  constraint command_requests_fingerprint_sha256
    check (octet_length(request_fingerprint) = 32),
  constraint command_requests_state_known
    check (state in ('in_progress', 'completed', 'failed')),
  constraint command_requests_resource_pair check (
    (resource_kind is null and resource_id is null)
    or (
      resource_kind is not null
      and resource_kind ~ '^[a-z][a-z0-9_]{1,63}$'
      and resource_id is not null
    )
  ),
  constraint command_requests_http_status_bound
    check (http_status is null or http_status between 200 and 599),
  constraint command_requests_error_code_format check (
    error_code is null or error_code ~ '^[A-Z][A-Z0-9_]{1,63}$'
  ),
  constraint command_requests_expiry_after_creation check (expires_at > created_at),
  constraint command_requests_scope_key_unique
    unique (operation, principal_scope_hash, idempotency_key)
);

create table gioia_private.schedule_day_locks (
  local_date date primary key,
  created_at timestamptz not null default statement_timestamp()
);

create table gioia_private.vacations (
  id uuid primary key default extensions.gen_random_uuid(),
  schema_version smallint not null default 1,
  start_date date not null,
  end_date date not null,
  date_span daterange generated always as (
    daterange(start_date, end_date + 1, '[)')
  ) stored,
  status text not null default 'active',
  reason text,
  source text not null,
  created_by uuid references auth.users(id) on update restrict on delete set null,
  legacy_firestore_id text unique,
  timestamp_provenance text not null default 'source',
  imported_at timestamptz,
  cancelled_at timestamptz,
  cancelled_by uuid references auth.users(id) on update restrict on delete set null,
  version integer not null default 1,
  created_at timestamptz not null default statement_timestamp(),
  updated_at timestamptz not null default statement_timestamp(),
  constraint vacations_schema_version_current check (schema_version = 1),
  constraint vacations_date_order check (start_date <= end_date),
  constraint vacations_maximum_span check (end_date - start_date between 0 and 365),
  constraint vacations_status_known check (status in ('active', 'cancelled')),
  constraint vacations_reason_bound check (reason is null or length(reason) <= 1000),
  constraint vacations_source_known check (source in ('admin', 'migration')),
  constraint vacations_admin_creator_required check (source <> 'admin' or created_by is not null),
  constraint vacations_legacy_id_bound
    check (legacy_firestore_id is null or octet_length(legacy_firestore_id) between 1 and 1500),
  constraint vacations_timestamp_provenance_known
    check (timestamp_provenance in ('source', 'import_time')),
  constraint vacations_import_consistent check (
    (source = 'migration' and imported_at is not null and legacy_firestore_id is not null)
    or (source = 'admin' and imported_at is null and legacy_firestore_id is null)
  ),
  constraint vacations_cancellation_consistent check (
    (status = 'active' and cancelled_at is null and cancelled_by is null)
    or (status = 'cancelled' and cancelled_at is not null
      and (source = 'migration' or cancelled_by is not null))
  ),
  constraint vacations_version_positive check (version > 0),
  exclude using gist (date_span with &&) where (status = 'active')
);

create table gioia_private.schedule_entries (
  id uuid primary key default extensions.gen_random_uuid(),
  schema_version smallint not null default 1,
  kind text not null,
  status text not null,
  source text not null,
  local_date date not null,
  start_minutes smallint not null,
  service_duration_minutes smallint not null,
  buffer_minutes smallint not null default 0,
  occupied_span int4range generated always as (
    int4range(
      start_minutes::integer,
      start_minutes::integer + service_duration_minutes::integer + buffer_minutes::integer,
      '[)'
    )
  ) stored,
  service_id text,
  variant_id text,
  service_name_snapshot text,
  variant_name_snapshot text,
  price_cents_snapshot integer,
  currency_snapshot character(3),
  client_name text,
  client_email extensions.citext,
  client_phone text,
  client_note text,
  internal_note text,
  created_by uuid references auth.users(id) on update restrict on delete set null,
  legacy_firestore_id text unique,
  timestamp_provenance text not null default 'source',
  imported_at timestamptz,
  cancelled_at timestamptz,
  cancelled_by text,
  cancellation_reason text,
  version integer not null default 1,
  created_at timestamptz not null default statement_timestamp(),
  updated_at timestamptz not null default statement_timestamp(),
  constraint schedule_entries_schema_version_current check (schema_version = 1),
  constraint schedule_entries_kind_known check (kind in ('appointment', 'block')),
  constraint schedule_entries_source_known check (source in ('public', 'admin', 'migration')),
  constraint schedule_entries_status_by_kind check (
    (kind = 'appointment' and status in ('confirmed', 'completed', 'cancelled', 'no_show'))
    or (kind = 'block' and status in ('active', 'cancelled'))
  ),
  constraint schedule_entries_public_shape check (
    source <> 'public'
    or (kind = 'appointment' and created_by is null and internal_note is null)
  ),
  constraint schedule_entries_admin_creator_required check (source <> 'admin' or created_by is not null),
  constraint schedule_entries_time_bounds check (
    start_minutes between 0 and 1439
    and service_duration_minutes between 1 and 480
    and buffer_minutes between 0 and 120
    and start_minutes + service_duration_minutes + buffer_minutes <= 1440
  ),
  constraint schedule_entries_service_pair foreign key (service_id, variant_id)
    references gioia_private.service_variants(service_id, id)
    on update restrict on delete restrict,
  constraint schedule_entries_price_complete check (
    (price_cents_snapshot is null and currency_snapshot is null)
    or (price_cents_snapshot is not null and price_cents_snapshot >= 0
      and currency_snapshot is not null and currency_snapshot = 'EUR')
  ),
  constraint schedule_entries_appointment_shape check (
    kind <> 'appointment'
    or (
      service_id is not null
      and variant_id is not null
      and service_name_snapshot is not null
      and variant_name_snapshot is not null
      and client_name is not null
      and length(btrim(service_name_snapshot)) between 1 and 160
      and length(btrim(variant_name_snapshot)) between 1 and 160
      and length(btrim(client_name)) between 1 and 160
    )
  ),
  constraint schedule_entries_block_shape check (
    kind <> 'block'
    or (
      service_id is null
      and variant_id is null
      and service_name_snapshot is null
      and variant_name_snapshot is null
      and price_cents_snapshot is null
      and currency_snapshot is null
      and client_name is null
      and client_email is null
      and client_phone is null
      and client_note is null
    )
  ),
  constraint schedule_entries_email_normalized check (
    client_email is null
    or client_email::text = lower(btrim(client_email::text))
  ),
  constraint schedule_entries_client_fields_bounded check (
    (client_email is null or length(client_email::text) between 3 and 320)
    and (client_phone is null or length(client_phone) between 1 and 40)
    and (client_note is null or length(client_note) <= 2000)
    and (internal_note is null or length(internal_note) <= 2000)
  ),
  constraint schedule_entries_legacy_id_bound
    check (legacy_firestore_id is null or octet_length(legacy_firestore_id) between 1 and 1500),
  constraint schedule_entries_timestamp_provenance_known
    check (timestamp_provenance in ('source', 'import_time')),
  constraint schedule_entries_import_consistent check (
    (source = 'migration' and imported_at is not null and legacy_firestore_id is not null)
    or (source in ('public', 'admin') and imported_at is null and legacy_firestore_id is null)
  ),
  constraint schedule_entries_cancellation_consistent check (
    (status <> 'cancelled' and cancelled_at is null and cancelled_by is null and cancellation_reason is null)
    or (
      status = 'cancelled'
      and cancelled_at is not null
      and cancelled_by is not null
      and cancelled_by in ('client', 'admin', 'system', 'migration')
      and (cancellation_reason is null or length(cancellation_reason) <= 1000)
    )
  ),
  constraint schedule_entries_version_positive check (version > 0),
  exclude using gist (
    local_date with =,
    occupied_span with &&
  ) where (status in ('confirmed', 'completed', 'active'))
);

create index command_requests_expiry_idx
  on gioia_private.command_requests (expires_at, id);
create index vacations_active_dates_idx
  on gioia_private.vacations (start_date, end_date, id)
  where status = 'active';
create index schedule_entries_day_status_idx
  on gioia_private.schedule_entries (local_date, status, start_minutes, id);
create index schedule_entries_updated_idx
  on gioia_private.schedule_entries (updated_at, id);
create index schedule_entries_client_email_idx
  on gioia_private.schedule_entries (client_email, local_date desc, id)
  where client_email is not null;

alter table gioia_private.owner_accounts enable row level security;
alter table gioia_private.owner_accounts force row level security;
alter table gioia_private.command_requests enable row level security;
alter table gioia_private.command_requests force row level security;
alter table gioia_private.schedule_day_locks enable row level security;
alter table gioia_private.schedule_day_locks force row level security;
alter table gioia_private.vacations enable row level security;
alter table gioia_private.vacations force row level security;
alter table gioia_private.schedule_entries enable row level security;
alter table gioia_private.schedule_entries force row level security;

create policy owner_accounts_mutator_all on gioia_private.owner_accounts
  for all to gioia_mutator using (true) with check (true);
create policy command_requests_mutator_all on gioia_private.command_requests
  for all to gioia_mutator using (true) with check (true);
create policy schedule_day_locks_mutator_all on gioia_private.schedule_day_locks
  for all to gioia_mutator using (true) with check (true);
create policy vacations_mutator_all on gioia_private.vacations
  for all to gioia_mutator using (true) with check (true);
create policy schedule_entries_mutator_all on gioia_private.schedule_entries
  for all to gioia_mutator using (true) with check (true);

grant select, insert, update on table
  gioia_private.owner_accounts,
  gioia_private.vacations,
  gioia_private.schedule_entries
to gioia_mutator;
grant select, insert on table gioia_private.schedule_day_locks to gioia_mutator;
grant select, insert, update, delete on table gioia_private.command_requests to gioia_mutator;

create trigger owner_accounts_touch before update on gioia_private.owner_accounts
  for each row execute function gioia_private.set_updated_at_and_version();
create trigger vacations_touch before update on gioia_private.vacations
  for each row execute function gioia_private.set_updated_at_and_version();
create trigger schedule_entries_touch before update on gioia_private.schedule_entries
  for each row execute function gioia_private.set_updated_at_and_version();

revoke all on all tables in schema gioia_private
  from public, anon, authenticated, service_role, app_runtime;

commit;

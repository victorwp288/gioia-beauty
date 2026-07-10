begin;

set local lock_timeout = '5s';
set local statement_timeout = '30s';

create table gioia_private.migration_runs (
  id uuid primary key,
  run_kind text not null,
  source_project_ref text not null,
  dry_run boolean not null,
  status text not null default 'running',
  source_manifest_sha256 bytea not null,
  counts jsonb not null default '{}'::jsonb,
  started_at timestamptz not null default statement_timestamp(),
  completed_at timestamptz,
  constraint migration_runs_kind_known
    check (run_kind in ('inventory', 'import', 'reconcile')),
  constraint migration_runs_project_ref_bound
    check (octet_length(source_project_ref) between 6 and 255),
  constraint migration_runs_status_known
    check (status in ('running', 'completed', 'failed', 'stopped')),
  constraint migration_runs_manifest_sha256
    check (octet_length(source_manifest_sha256) = 32),
  constraint migration_runs_counts_bounded check (
    jsonb_typeof(counts) = 'object' and octet_length(counts::text) <= 16384
  ),
  constraint migration_runs_completion_consistent check (
    (status = 'running' and completed_at is null)
    or (status <> 'running' and completed_at is not null and completed_at >= started_at)
  )
);

alter table gioia_private.domain_change_log
  add constraint domain_change_log_migration_run_fk
  foreign key (migration_run_id) references gioia_private.migration_runs(id)
  on update restrict on delete restrict;

create table gioia_private.migration_records (
  run_id uuid not null references gioia_private.migration_runs(id)
    on update restrict on delete restrict,
  source_collection text not null,
  source_record_id text not null,
  source_record_sha256 bytea not null,
  disposition text not null,
  target_kind text,
  target_id uuid,
  target_record_sha256 bytea,
  recorded_at timestamptz not null default statement_timestamp(),
  primary key (run_id, source_collection, source_record_id),
  constraint migration_records_disposition_lookup_unique
    unique (run_id, source_collection, source_record_id, disposition),
  constraint migration_records_source_collection_format
    check (source_collection ~ '^[a-z][a-z0-9_]{0,99}$'),
  constraint migration_records_source_id_bound
    check (octet_length(source_record_id) between 1 and 1500),
  constraint migration_records_source_sha256
    check (octet_length(source_record_sha256) = 32),
  constraint migration_records_disposition_known
    check (disposition in ('imported', 'quarantined')),
  constraint migration_records_target_kind_known check (
    target_kind is null or target_kind in ('schedule_entry', 'vacation', 'subscriber')
  ),
  constraint migration_records_target_shape check (
    (disposition = 'imported' and target_kind is not null and target_id is not null
      and target_record_sha256 is not null and octet_length(target_record_sha256) = 32)
    or (disposition = 'quarantined' and target_kind is null and target_id is null
      and target_record_sha256 is null)
  )
);

create unique index migration_records_run_target_unique_idx
  on gioia_private.migration_records (run_id, target_kind, target_id)
  where disposition = 'imported';
create index migration_records_source_history_idx
  on gioia_private.migration_records (source_collection, source_record_id, run_id);

create table gioia_private.migration_quarantine (
  id bigint generated always as identity primary key,
  run_id uuid not null,
  source_collection text not null,
  source_record_id text not null,
  ledger_disposition text not null default 'quarantined',
  reason_code text not null,
  field_codes text[] not null default '{}',
  resolved_at timestamptz,
  resolution_code text,
  resolution_run_id uuid references gioia_private.migration_runs(id)
    on update restrict on delete restrict,
  resolved_target_kind text,
  resolved_target_id uuid,
  created_at timestamptz not null default statement_timestamp(),
  constraint migration_quarantine_ledger_fk foreign key (
    run_id, source_collection, source_record_id, ledger_disposition
  ) references gioia_private.migration_records (
    run_id, source_collection, source_record_id, disposition
  ) on update restrict on delete restrict,
  constraint migration_quarantine_disposition_fixed check (ledger_disposition = 'quarantined'),
  constraint migration_quarantine_reason_code_format
    check (reason_code ~ '^[A-Z][A-Z0-9_]{1,63}$'),
  constraint migration_quarantine_field_codes_safe check (
    cardinality(field_codes) <= 50
    and array_position(field_codes, null::text) is null
    and (cardinality(field_codes) = 0 or array_to_string(field_codes, ',')
      ~ '^[A-Z][A-Z0-9_]{1,63}(,[A-Z][A-Z0-9_]{1,63})*$')
  ),
  constraint migration_quarantine_target_kind_known check (
    resolved_target_kind is null
    or resolved_target_kind in ('schedule_entry', 'vacation', 'subscriber')
  ),
  constraint migration_quarantine_target_pair check (
    (resolved_target_kind is null and resolved_target_id is null)
    or (resolved_target_kind is not null and resolved_target_id is not null)
  ),
  constraint migration_quarantine_resolution_consistent check (
    (resolved_at is null and resolution_code is null and resolution_run_id is null
      and resolved_target_kind is null and resolved_target_id is null)
    or (resolved_at is not null and resolution_code is not null
      and resolution_run_id is not null
      and resolution_code ~ '^[A-Z][A-Z0-9_]{1,63}$')
  ),
  constraint migration_quarantine_run_record_unique
    unique (run_id, source_collection, source_record_id)
);

create index migration_quarantine_unresolved_idx
  on gioia_private.migration_quarantine (run_id, id)
  where resolved_at is null;

alter table gioia_private.migration_runs enable row level security;
alter table gioia_private.migration_runs force row level security;
alter table gioia_private.migration_records enable row level security;
alter table gioia_private.migration_records force row level security;
alter table gioia_private.migration_quarantine enable row level security;
alter table gioia_private.migration_quarantine force row level security;

create policy migration_runs_migrator_select on gioia_private.migration_runs
  for select to gioia_migrator using (true);
create policy migration_runs_migrator_insert on gioia_private.migration_runs
  for insert to gioia_migrator with check (true);
create policy migration_runs_migrator_update on gioia_private.migration_runs
  for update to gioia_migrator using (true) with check (true);
create policy migration_records_migrator_select on gioia_private.migration_records
  for select to gioia_migrator using (true);
create policy migration_records_migrator_insert on gioia_private.migration_records
  for insert to gioia_migrator with check (true);
create policy migration_quarantine_migrator_select on gioia_private.migration_quarantine
  for select to gioia_migrator using (true);
create policy migration_quarantine_migrator_insert on gioia_private.migration_quarantine
  for insert to gioia_migrator with check (true);
create policy migration_quarantine_migrator_update on gioia_private.migration_quarantine
  for update to gioia_migrator using (true) with check (true);
create policy domain_change_log_migrator_insert on gioia_private.domain_change_log
  for insert to gioia_migrator with check (source = 'migration');
create policy domain_change_log_migrator_select on gioia_private.domain_change_log
  for select to gioia_migrator using (source = 'migration');

grant select, insert, update on table gioia_private.migration_runs to gioia_migrator;
grant select, insert on table gioia_private.migration_records to gioia_migrator;
grant select, insert, update on table gioia_private.migration_quarantine to gioia_migrator;
grant select, insert on table gioia_private.domain_change_log to gioia_migrator;
grant usage, select on all sequences in schema gioia_private to gioia_migrator;

revoke all on table
  gioia_private.migration_runs,
  gioia_private.migration_records,
  gioia_private.migration_quarantine
from public, anon, authenticated, service_role, app_runtime, gioia_mutator;
revoke all on all sequences in schema gioia_private
  from public, anon, authenticated, service_role, app_runtime;

commit;

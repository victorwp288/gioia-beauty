begin;

set local lock_timeout = '5s';
set local statement_timeout = '30s';

grant gioia_migrator to postgres;
grant create on schema gioia_private to gioia_migrator;

set local role gioia_migrator;

create table gioia_private.privacy_policy_versions (
  policy_version text primary key,
  environment text not null,
  target_id text not null,
  artifact_sha256 bytea not null,
  status text not null default 'draft',
  approved_at timestamptz,
  approval_evidence_sha256 bytea,
  created_at timestamptz not null default statement_timestamp(),
  constraint privacy_policy_version_format
    check (policy_version ~ '^[a-z0-9][a-z0-9._-]{2,99}$'),
  constraint privacy_policy_environment_known
    check (environment in ('local', 'test', 'production')),
  constraint privacy_policy_target_bound
    check (length(target_id) between 3 and 100
      and target_id ~ '^[A-Za-z0-9._-]+$'),
  constraint privacy_policy_artifact_sha256
    check (octet_length(artifact_sha256) = 32),
  constraint privacy_policy_status_known
    check (status in ('draft', 'approved', 'retired')),
  constraint privacy_policy_approval_shape check (
    (status = 'draft' and approved_at is null
      and approval_evidence_sha256 is null)
    or (status in ('approved', 'retired') and approved_at is not null
      and approval_evidence_sha256 is not null
      and octet_length(approval_evidence_sha256) = 32)
  )
);

create unique index privacy_policy_one_approved_target_idx
  on gioia_private.privacy_policy_versions (environment, target_id)
  where status = 'approved';

create table gioia_private.privacy_policy_decisions (
  policy_version text not null references gioia_private.privacy_policy_versions(policy_version)
    on update restrict on delete restrict,
  decision_id text not null,
  status text not null default 'pending',
  decision_artifact_sha256 bytea,
  decided_at timestamptz,
  primary key (policy_version, decision_id),
  constraint privacy_decision_id_known check (decision_id in (
    'RET-01','RET-02','RET-03','RET-04','RET-05','RET-06','RET-07',
    'RET-08','RET-09','RET-10','RET-11','RET-12','RET-13','RET-14',
    'RET-15','RET-16','RET-17','RET-HOLD'
  )),
  constraint privacy_decision_status_known
    check (status in ('pending', 'approved', 'rejected')),
  constraint privacy_decision_evidence_shape check (
    (status = 'pending' and decision_artifact_sha256 is null
      and decided_at is null)
    or (status in ('approved', 'rejected') and decided_at is not null
      and decision_artifact_sha256 is not null
      and octet_length(decision_artifact_sha256) = 32)
  )
);

create table gioia_private.privacy_subject_requests (
  case_id uuid primary key,
  policy_version text not null references gioia_private.privacy_policy_versions(policy_version)
    on update restrict on delete restrict,
  request_kind text not null,
  status text not null default 'inventory_ready',
  selector_count smallint not null,
  selector_manifest_sha256 bytea not null,
  identity_evidence_sha256 bytea not null,
  identity_verified_at timestamptz not null,
  created_at timestamptz not null default statement_timestamp(),
  updated_at timestamptz not null default statement_timestamp(),
  constraint privacy_request_case_policy_unique unique (case_id, policy_version),
  constraint privacy_request_kind_known
    check (request_kind in ('access', 'erasure')),
  constraint privacy_request_status_known
    check (status in ('inventory_ready', 'scrub_planned', 'blocked', 'closed')),
  constraint privacy_request_selector_bound check (selector_count between 1 and 3),
  constraint privacy_request_selector_sha256
    check (octet_length(selector_manifest_sha256) = 32),
  constraint privacy_request_identity_sha256
    check (octet_length(identity_evidence_sha256) = 32),
  constraint privacy_request_identity_time
    check (identity_verified_at <= created_at)
);

create table gioia_private.privacy_holds (
  hold_id uuid primary key default extensions.gen_random_uuid(),
  case_id uuid not null,
  policy_version text not null,
  scope_code text not null,
  purpose_evidence_sha256 bytea not null,
  starts_at timestamptz not null,
  review_at timestamptz not null,
  expires_at timestamptz not null,
  released_at timestamptz,
  created_at timestamptz not null default statement_timestamp(),
  constraint privacy_hold_request_policy_fk foreign key (case_id, policy_version)
    references gioia_private.privacy_subject_requests(case_id, policy_version)
    on update restrict on delete restrict,
  constraint privacy_hold_scope_known check (scope_code in (
    'all_subject_records','schedule_entries','newsletter_subscribers',
    'email_delivery','command_audit','migration_evidence','owner_auth'
  )),
  constraint privacy_hold_purpose_sha256
    check (octet_length(purpose_evidence_sha256) = 32),
  constraint privacy_hold_time_order check (
    starts_at <= review_at and review_at <= expires_at
    and (released_at is null or released_at >= starts_at)
  )
);

create index privacy_holds_active_case_idx
  on gioia_private.privacy_holds (case_id, expires_at, hold_id)
  where released_at is null;

create table gioia_private.privacy_request_inventory (
  case_id uuid not null references gioia_private.privacy_subject_requests(case_id)
    on update restrict on delete restrict,
  store_name text not null,
  matched_rows integer not null,
  capped boolean not null,
  inventoried_at timestamptz not null default statement_timestamp(),
  primary key (case_id, store_name),
  constraint privacy_inventory_store_known check (store_name in (
    'schedule_entries','newsletter_subscribers','email_outbox',
    'email_webhook_events','command_requests','domain_change_log',
    'migration_evidence','owner_auth'
  )),
  constraint privacy_inventory_rows_bound check (matched_rows between 0 and 100)
);

create table gioia_private.privacy_scrub_plan_items (
  case_id uuid not null,
  store_name text not null,
  matched_rows integer not null,
  field_codes text[] not null,
  decision_ids text[] not null,
  planned_at timestamptz not null default statement_timestamp(),
  primary key (case_id, store_name),
  constraint privacy_scrub_plan_inventory_fk foreign key (case_id, store_name)
    references gioia_private.privacy_request_inventory(case_id, store_name)
    on update restrict on delete restrict,
  constraint privacy_scrub_plan_rows_bound check (matched_rows between 0 and 100),
  constraint privacy_scrub_plan_fields_bound check (
    cardinality(field_codes) between 1 and 16
    and array_position(field_codes, null::text) is null
    and array_to_string(field_codes, ',')
      ~ '^[a-z][a-z0-9_]{0,62}(,[a-z][a-z0-9_]{0,62})*$'
  ),
  constraint privacy_scrub_plan_decisions_bound check (
    cardinality(decision_ids) between 1 and 8
    and array_position(decision_ids, null::text) is null
    and array_to_string(decision_ids, ',')
      ~ '^RET-(0[1-9]|1[0-7]|HOLD)(,RET-(0[1-9]|1[0-7]|HOLD))*$'
  )
);

create table gioia_private.privacy_operation_evidence (
  sequence_id bigint generated always as identity primary key,
  case_id uuid not null references gioia_private.privacy_subject_requests(case_id)
    on update restrict on delete restrict,
  policy_version text not null references gioia_private.privacy_policy_versions(policy_version)
    on update restrict on delete restrict,
  event_kind text not null,
  row_count integer not null,
  artifact_sha256 bytea not null,
  occurred_at timestamptz not null default statement_timestamp(),
  constraint privacy_evidence_event_known
    check (event_kind in ('inventory_created', 'scrub_plan_created')),
  constraint privacy_evidence_row_bound check (row_count between 0 and 10000),
  constraint privacy_evidence_artifact_sha256
    check (octet_length(artifact_sha256) = 32),
  constraint privacy_evidence_case_event_unique unique (case_id, event_kind)
);

create index privacy_operation_evidence_case_idx
  on gioia_private.privacy_operation_evidence (case_id, sequence_id);

alter table gioia_private.privacy_policy_versions enable row level security;
alter table gioia_private.privacy_policy_versions force row level security;
alter table gioia_private.privacy_policy_decisions enable row level security;
alter table gioia_private.privacy_policy_decisions force row level security;
alter table gioia_private.privacy_subject_requests enable row level security;
alter table gioia_private.privacy_subject_requests force row level security;
alter table gioia_private.privacy_holds enable row level security;
alter table gioia_private.privacy_holds force row level security;
alter table gioia_private.privacy_request_inventory enable row level security;
alter table gioia_private.privacy_request_inventory force row level security;
alter table gioia_private.privacy_scrub_plan_items enable row level security;
alter table gioia_private.privacy_scrub_plan_items force row level security;
alter table gioia_private.privacy_operation_evidence enable row level security;
alter table gioia_private.privacy_operation_evidence force row level security;

create policy privacy_policy_versions_migrator_all
  on gioia_private.privacy_policy_versions for all to gioia_migrator
  using (true) with check (true);
create policy privacy_policy_decisions_migrator_all
  on gioia_private.privacy_policy_decisions for all to gioia_migrator
  using (true) with check (true);
create policy privacy_subject_requests_migrator_all
  on gioia_private.privacy_subject_requests for all to gioia_migrator
  using (true) with check (true);
create policy privacy_holds_migrator_all
  on gioia_private.privacy_holds for all to gioia_migrator
  using (true) with check (true);
create policy privacy_request_inventory_migrator_all
  on gioia_private.privacy_request_inventory for all to gioia_migrator
  using (true) with check (true);
create policy privacy_scrub_plan_items_migrator_all
  on gioia_private.privacy_scrub_plan_items for all to gioia_migrator
  using (true) with check (true);
create policy privacy_operation_evidence_migrator_all
  on gioia_private.privacy_operation_evidence for all to gioia_migrator
  using (true) with check (true);

reset role;

create index schedule_entries_client_phone_privacy_idx
  on gioia_private.schedule_entries (client_phone, id)
  where client_phone is not null;
create index email_outbox_recipient_privacy_idx
  on gioia_private.email_outbox (recipient_address, id);
create index command_requests_resource_privacy_idx
  on gioia_private.command_requests (resource_kind, resource_id, id)
  where resource_id is not null;
create index migration_records_target_privacy_idx
  on gioia_private.migration_records (target_kind, target_id, run_id)
  where target_id is not null;

revoke create on schema gioia_private from gioia_migrator;
revoke gioia_migrator from postgres;

commit;

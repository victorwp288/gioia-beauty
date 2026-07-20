begin;

set local lock_timeout = '5s';
set local statement_timeout = '30s';

grant gioia_mutator to postgres;
grant create on schema gioia_private to gioia_mutator;
set local role gioia_mutator;

create table gioia_private.cutover_write_control (
  singleton boolean primary key default true,
  mode text not null default 'open',
  freeze_id uuid,
  version integer not null default 1,
  reason_code text not null default 'INITIAL_LOCAL_STATE',
  changed_at timestamptz not null default statement_timestamp(),
  constraint cutover_write_control_singleton check (singleton),
  constraint cutover_write_control_mode_known
    check (mode in ('open', 'frozen', 'owner_reconcile')),
  constraint cutover_write_control_freeze_consistent check (
    (mode = 'open' and freeze_id is null)
    or (mode in ('frozen', 'owner_reconcile') and freeze_id is not null)
  ),
  constraint cutover_write_control_version_positive check (version > 0),
  constraint cutover_write_control_reason_code_safe
    check (reason_code ~ '^[A-Z][A-Z0-9_]{1,63}$')
);

insert into gioia_private.cutover_write_control (singleton) values (true);

create table gioia_private.cutover_transition_log (
  sequence_id bigint generated always as identity primary key,
  freeze_id uuid,
  from_mode text not null,
  to_mode text not null,
  control_version integer not null,
  reason_code text not null,
  changed_at timestamptz not null default statement_timestamp(),
  constraint cutover_transition_log_from_mode_known
    check (from_mode in ('open', 'frozen', 'owner_reconcile')),
  constraint cutover_transition_log_to_mode_known
    check (to_mode in ('open', 'frozen', 'owner_reconcile')),
  constraint cutover_transition_log_actual_change check (from_mode <> to_mode),
  constraint cutover_transition_log_version_positive check (control_version > 1),
  constraint cutover_transition_log_reason_code_safe
    check (reason_code ~ '^[A-Z][A-Z0-9_]{1,63}$')
);

create table gioia_private.cutover_canary_runs (
  id uuid primary key default extensions.gen_random_uuid(),
  freeze_id uuid not null,
  label_code text not null,
  status text not null default 'active',
  expires_at timestamptz not null,
  created_at timestamptz not null default statement_timestamp(),
  reconciled_at timestamptz,
  constraint cutover_canary_runs_label_safe
    check (label_code ~ '^[A-Z][A-Z0-9_]{1,63}$'),
  constraint cutover_canary_runs_status_known
    check (status in ('active', 'reconciled')),
  constraint cutover_canary_runs_expiry_bound check (
    expires_at > created_at and expires_at <= created_at + interval '30 minutes'
  ),
  constraint cutover_canary_runs_reconcile_consistent check (
    (status = 'active' and reconciled_at is null)
    or (status = 'reconciled' and reconciled_at is not null)
  )
);

create index cutover_canary_runs_freeze_status_idx
  on gioia_private.cutover_canary_runs (freeze_id, status, created_at, id);

create table gioia_private.cutover_canary_grants (
  id uuid primary key default extensions.gen_random_uuid(),
  run_id uuid not null references gioia_private.cutover_canary_runs(id)
    on update restrict on delete restrict,
  token_sha256 bytea not null unique,
  operation text not null,
  idempotency_key text not null,
  request_fingerprint bytea not null,
  status text not null default 'issued',
  expires_at timestamptz not null,
  created_at timestamptz not null default statement_timestamp(),
  used_at timestamptz,
  revoked_at timestamptz,
  constraint cutover_canary_grants_token_sha256
    check (octet_length(token_sha256) = 32),
  constraint cutover_canary_grants_operation_known check (operation in (
    'public_booking', 'owner_create_appointment', 'owner_create_block',
    'owner_update_appointment_details', 'owner_update_block_details',
    'owner_reschedule_appointment', 'owner_reschedule_block',
    'owner_set_appointment_status', 'owner_cancel_schedule_entry',
    'owner_create_vacation', 'owner_update_vacation', 'owner_cancel_vacation',
    'owner_unsubscribe_subscriber', 'owner_outbox_retry'
  )),
  constraint cutover_canary_grants_idempotency_key_safe check (
    idempotency_key ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
  ),
  constraint cutover_canary_grants_request_fingerprint
    check (octet_length(request_fingerprint) = 32),
  constraint cutover_canary_grants_status_known
    check (status in ('issued', 'used', 'revoked')),
  constraint cutover_canary_grants_expiry_bound check (
    expires_at > created_at and expires_at <= created_at + interval '15 minutes'
  ),
  constraint cutover_canary_grants_lifecycle_consistent check (
    (status = 'issued' and used_at is null and revoked_at is null)
    or (status = 'used' and used_at is not null and revoked_at is null)
    or (status = 'revoked' and used_at is null and revoked_at is not null)
  )
);

create index cutover_canary_grants_run_status_idx
  on gioia_private.cutover_canary_grants (run_id, status, created_at, id);

create table gioia_private.cutover_canary_events (
  sequence_id bigint generated always as identity primary key,
  grant_id uuid not null unique references gioia_private.cutover_canary_grants(id)
    on update restrict on delete restrict,
  run_id uuid not null references gioia_private.cutover_canary_runs(id)
    on update restrict on delete restrict,
  freeze_id uuid not null,
  operation text not null,
  event_kind text not null,
  occurred_at timestamptz not null default statement_timestamp(),
  constraint cutover_canary_events_operation_safe
    check (operation ~ '^[a-z][a-z0-9_]{1,63}$'),
  constraint cutover_canary_events_kind_known check (event_kind = 'authorized')
);

alter table gioia_private.cutover_write_control enable row level security;
alter table gioia_private.cutover_write_control force row level security;
alter table gioia_private.cutover_transition_log enable row level security;
alter table gioia_private.cutover_transition_log force row level security;
alter table gioia_private.cutover_canary_runs enable row level security;
alter table gioia_private.cutover_canary_runs force row level security;
alter table gioia_private.cutover_canary_grants enable row level security;
alter table gioia_private.cutover_canary_grants force row level security;
alter table gioia_private.cutover_canary_events enable row level security;
alter table gioia_private.cutover_canary_events force row level security;

create policy cutover_write_control_mutator_all
  on gioia_private.cutover_write_control for all to gioia_mutator
  using (true) with check (true);
create policy cutover_transition_log_mutator_all
  on gioia_private.cutover_transition_log for all to gioia_mutator
  using (true) with check (true);
create policy cutover_canary_runs_mutator_all
  on gioia_private.cutover_canary_runs for all to gioia_mutator
  using (true) with check (true);
create policy cutover_canary_grants_mutator_all
  on gioia_private.cutover_canary_grants for all to gioia_mutator
  using (true) with check (true);
create policy cutover_canary_events_mutator_all
  on gioia_private.cutover_canary_events for all to gioia_mutator
  using (true) with check (true);

grant select, update on gioia_private.cutover_write_control to gioia_mutator;
grant select, insert on gioia_private.cutover_transition_log to gioia_mutator;
grant select, insert, update on gioia_private.cutover_canary_runs to gioia_mutator;
grant select, insert, update on gioia_private.cutover_canary_grants to gioia_mutator;
grant select, insert on gioia_private.cutover_canary_events to gioia_mutator;

create function gioia_private.get_cutover_write_state()
returns table (mode text, version integer)
language sql stable security definer set search_path = ''
as $$
  select control.mode, control.version
  from gioia_private.cutover_write_control as control where control.singleton
$$;

reset role;

alter table gioia_private.cutover_write_control owner to postgres;
alter table gioia_private.cutover_transition_log owner to postgres;
alter table gioia_private.cutover_canary_runs owner to postgres;
alter table gioia_private.cutover_canary_grants owner to postgres;
alter table gioia_private.cutover_canary_events owner to postgres;

revoke all on table gioia_private.cutover_write_control,
  gioia_private.cutover_transition_log, gioia_private.cutover_canary_runs,
  gioia_private.cutover_canary_grants, gioia_private.cutover_canary_events
from gioia_mutator;
grant select, update on gioia_private.cutover_write_control to gioia_mutator;
grant select, insert on gioia_private.cutover_transition_log to gioia_mutator;
grant select, insert, update on gioia_private.cutover_canary_runs to gioia_mutator;
grant select, insert, update on gioia_private.cutover_canary_grants to gioia_mutator;
grant select, insert on gioia_private.cutover_canary_events to gioia_mutator;

revoke create on schema gioia_private from gioia_mutator;

revoke all on table gioia_private.cutover_write_control,
  gioia_private.cutover_transition_log, gioia_private.cutover_canary_runs,
  gioia_private.cutover_canary_grants, gioia_private.cutover_canary_events
from public, anon, authenticated, service_role, app_runtime, gioia_migrator;
revoke all on function gioia_private.get_cutover_write_state()
  from public, anon, authenticated, service_role, gioia_migrator;
grant execute on function gioia_private.get_cutover_write_state() to app_runtime;

revoke gioia_mutator from postgres;
commit;

begin;

set local lock_timeout = '5s';
set local statement_timeout = '30s';

create index domain_change_log_actor_user_idx
  on gioia_private.domain_change_log (actor_user_id)
  where actor_user_id is not null;

create index domain_change_log_migration_run_idx
  on gioia_private.domain_change_log (migration_run_id)
  where migration_run_id is not null;

create index migration_quarantine_ledger_idx
  on gioia_private.migration_quarantine (
    run_id, source_collection, source_record_id, ledger_disposition
  );

create index migration_quarantine_resolution_run_idx
  on gioia_private.migration_quarantine (resolution_run_id)
  where resolution_run_id is not null;

create index schedule_entries_created_by_idx
  on gioia_private.schedule_entries (created_by)
  where created_by is not null;

create index schedule_entries_service_variant_idx
  on gioia_private.schedule_entries (service_id, variant_id)
  where service_id is not null and variant_id is not null;

create index vacations_cancelled_by_idx
  on gioia_private.vacations (cancelled_by)
  where cancelled_by is not null;

create index vacations_created_by_idx
  on gioia_private.vacations (created_by)
  where created_by is not null;

commit;

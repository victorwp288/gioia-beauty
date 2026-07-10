begin;

set local search_path = extensions, public, pg_catalog;

select plan(8);

with expected(
  index_name,
  table_name,
  key_columns,
  predicate
) as (
  values
    (
      'domain_change_log_actor_user_idx',
      'domain_change_log',
      array['actor_user_id']::text[],
      'actor_user_id IS NOT NULL'
    ),
    (
      'domain_change_log_migration_run_idx',
      'domain_change_log',
      array['migration_run_id']::text[],
      'migration_run_id IS NOT NULL'
    ),
    (
      'migration_quarantine_ledger_idx',
      'migration_quarantine',
      array[
        'run_id', 'source_collection', 'source_record_id', 'ledger_disposition'
      ]::text[],
      null::text
    ),
    (
      'migration_quarantine_resolution_run_idx',
      'migration_quarantine',
      array['resolution_run_id']::text[],
      'resolution_run_id IS NOT NULL'
    ),
    (
      'schedule_entries_created_by_idx',
      'schedule_entries',
      array['created_by']::text[],
      'created_by IS NOT NULL'
    ),
    (
      'schedule_entries_service_variant_idx',
      'schedule_entries',
      array['service_id', 'variant_id']::text[],
      'service_id IS NOT NULL AND variant_id IS NOT NULL'
    ),
    (
      'vacations_cancelled_by_idx',
      'vacations',
      array['cancelled_by']::text[],
      'cancelled_by IS NOT NULL'
    ),
    (
      'vacations_created_by_idx',
      'vacations',
      array['created_by']::text[],
      'created_by IS NOT NULL'
    )
), actual as (
  select
    index_relation.relname::text as index_name,
    table_relation.relname::text as table_name,
    array(
      select pg_catalog.pg_get_indexdef(index_data.indexrelid, position, true)
      from pg_catalog.generate_series(1, index_data.indnkeyatts) as position
      order by position
    ) as key_columns,
    pg_catalog.regexp_replace(
      pg_catalog.lower(pg_catalog.pg_get_expr(
        index_data.indpred,
        index_data.indrelid,
        true
      )),
      '[()[:space:]]',
      '',
      'g'
    ) as normalized_predicate,
    index_data.indisvalid,
    index_data.indisready,
    index_data.indisunique
  from pg_catalog.pg_index as index_data
  join pg_catalog.pg_class as index_relation
    on index_relation.oid = index_data.indexrelid
  join pg_catalog.pg_class as table_relation
    on table_relation.oid = index_data.indrelid
  join pg_catalog.pg_namespace as namespace
    on namespace.oid = table_relation.relnamespace
  where namespace.nspname = 'gioia_private'
), checks as (
  select
    expected.index_name,
    expected.table_name,
    actual.index_name is not null
      and actual.table_name = expected.table_name
      and actual.key_columns = expected.key_columns
      and actual.normalized_predicate is not distinct from pg_catalog.regexp_replace(
        pg_catalog.lower(expected.predicate),
        '[()[:space:]]',
        '',
        'g'
      )
      and actual.indisvalid
      and actual.indisready
      and not actual.indisunique as valid
  from expected
  left join actual using (index_name)
)
select ok(
  valid,
  format(
    '%I covers the expected %I foreign-key columns and nullability',
    index_name,
    table_name
  )
)
from checks
order by index_name;

select * from finish();

rollback;

begin;

set local search_path = extensions, public, pg_catalog;

select plan(17);

select lives_ok(
  $sql$
    insert into gioia_private.migration_runs (
      id, run_kind, source_project_ref, dry_run, source_manifest_sha256
    ) values (
      '70000000-0000-4000-8000-000000000001', 'import',
      'synthetic-source.test', true, decode(repeat('11', 32), 'hex')
    )
  $sql$,
  'a deterministic synthetic migration run is accepted'
);

select throws_ok(
  $sql$
    insert into gioia_private.migration_runs (
      id, run_kind, source_project_ref, dry_run, source_manifest_sha256
    ) values (
      '70000000-0000-4000-8000-000000000099', 'import',
      'synthetic-source.test', true, decode('11', 'hex')
    )
  $sql$,
  '23514', null,
  'migration manifests require a SHA-256 digest'
);

select lives_ok(
  $sql$
    insert into gioia_private.migration_records (
      run_id, source_collection, source_record_id, source_record_sha256,
      disposition, target_kind, target_id, target_record_sha256
    ) values (
      '70000000-0000-4000-8000-000000000001', 'customers', 'appointment-001',
      decode(repeat('21', 32), 'hex'), 'imported', 'schedule_entry',
      '71000000-0000-4000-8000-000000000001', decode(repeat('31', 32), 'hex')
    )
  $sql$,
  'an imported source record has deterministic source and target evidence'
);

select throws_ok(
  $sql$
    insert into gioia_private.migration_records (
      run_id, source_collection, source_record_id, source_record_sha256,
      disposition
    ) values (
      '70000000-0000-4000-8000-000000000001', 'customers', 'appointment-002',
      decode(repeat('22', 32), 'hex'), 'imported'
    )
  $sql$,
  '23514', null,
  'imported records require complete target evidence'
);

select throws_ok(
  $sql$
    insert into gioia_private.migration_records (
      run_id, source_collection, source_record_id, source_record_sha256,
      disposition, target_kind, target_id, target_record_sha256
    ) values (
      '70000000-0000-4000-8000-000000000001', 'customers', 'appointment-001',
      decode(repeat('21', 32), 'hex'), 'imported', 'schedule_entry',
      '71000000-0000-4000-8000-000000000001', decode(repeat('31', 32), 'hex')
    )
  $sql$,
  '23505', null,
  'one source record has one disposition per migration run'
);

select lives_ok(
  $sql$
    insert into gioia_private.migration_records (
      run_id, source_collection, source_record_id, source_record_sha256,
      disposition
    ) values (
      '70000000-0000-4000-8000-000000000001', 'customers', 'malformed-001',
      decode(repeat('23', 32), 'hex'), 'quarantined'
    )
  $sql$,
  'a quarantined source record is represented in the record ledger'
);

select lives_ok(
  $sql$
    insert into gioia_private.migration_quarantine (
      run_id, source_collection, source_record_id, reason_code, field_codes
    ) values (
      '70000000-0000-4000-8000-000000000001', 'customers', 'malformed-001',
      'INVALID_DATE', array['SELECTED_DATE']
    )
  $sql$,
  'quarantine evidence must reference a quarantined ledger record'
);

select throws_ok(
  $sql$
    update gioia_private.migration_quarantine
    set resolved_at = statement_timestamp(), resolution_code = 'FIXED'
    where run_id = '70000000-0000-4000-8000-000000000001'
      and source_record_id = 'malformed-001'
  $sql$,
  '23514', null,
  'quarantine resolution evidence must be complete'
);

select lives_ok(
  $sql$
    update gioia_private.migration_quarantine
    set resolved_at = statement_timestamp(), resolution_code = 'MAPPED',
      resolution_run_id = '70000000-0000-4000-8000-000000000001',
      resolved_target_kind = 'schedule_entry',
      resolved_target_id = '71000000-0000-4000-8000-000000000002'
    where run_id = '70000000-0000-4000-8000-000000000001'
      and source_record_id = 'malformed-001'
  $sql$,
  'unresolved quarantine evidence can be resolved once'
);

select throws_ok(
  $sql$
    update gioia_private.migration_quarantine
    set resolution_code = 'CHANGED'
    where run_id = '70000000-0000-4000-8000-000000000001'
      and source_record_id = 'malformed-001'
  $sql$,
  '23514', 'Resolved migration quarantine is immutable',
  'resolved quarantine evidence is immutable'
);

select lives_ok(
  $sql$
    insert into gioia_private.migration_runs (
      id, run_kind, source_project_ref, dry_run, source_manifest_sha256
    ) values (
      '70000000-0000-4000-8000-000000000002', 'import',
      'synthetic-source.test', false, decode(repeat('12', 32), 'hex')
    )
  $sql$,
  'a second explicit migration run is accepted'
);

select lives_ok(
  $sql$
    insert into gioia_private.migration_records (
      run_id, source_collection, source_record_id, source_record_sha256,
      disposition, target_kind, target_id, target_record_sha256
    ) values (
      '70000000-0000-4000-8000-000000000002', 'customers', 'appointment-001',
      decode(repeat('21', 32), 'hex'), 'imported', 'schedule_entry',
      '71000000-0000-4000-8000-000000000003', decode(repeat('32', 32), 'hex')
    )
  $sql$,
  'the same source record can be reconciled in a distinct rerun'
);

select lives_ok(
  $sql$
    insert into gioia_private.domain_change_log (
      aggregate_kind, aggregate_id, aggregate_version, change_kind,
      source, migration_run_id, changed_fields
    ) values (
      'schedule_entry', '71000000-0000-4000-8000-000000000003', 1,
      'create', 'migration', '70000000-0000-4000-8000-000000000002',
      array['legacy_firestore_id', 'status']
    )
  $sql$,
  'migration audit records link to an explicit migration run'
);

select throws_ok(
  $sql$
    insert into gioia_private.domain_change_log (
      aggregate_kind, aggregate_id, aggregate_version,
      change_kind, source, changed_fields
    ) values (
      'schedule_entry', '71000000-0000-4000-8000-000000000004', 1,
      'create', 'migration', array['status']
    )
  $sql$,
  '23514', null,
  'migration audit records cannot omit their run link'
);

select lives_ok(
  $sql$
    update gioia_private.migration_runs
    set status = 'completed', completed_at = statement_timestamp(),
      counts = '{"source":2,"imported":1,"quarantined":1}'::jsonb
    where id = '70000000-0000-4000-8000-000000000001'
  $sql$,
  'a running migration can complete with bounded counts'
);

select throws_ok(
  $$update gioia_private.migration_runs
    set counts = '{"source":3}'::jsonb
    where id = '70000000-0000-4000-8000-000000000001'$$,
  '23514', 'Completed migration runs are immutable',
  'completed migration runs are immutable'
);

select ok(
  not has_table_privilege(
    'gioia_migrator', 'gioia_private.migration_records', 'UPDATE'
  )
    and not has_table_privilege(
      'gioia_migrator', 'gioia_private.migration_records', 'DELETE'
    )
    and not has_table_privilege(
      'gioia_migrator', 'gioia_private.migration_runs', 'DELETE'
    )
    and not has_table_privilege(
      'gioia_migrator', 'gioia_private.migration_quarantine', 'DELETE'
    ),
  'migrator ACLs preserve immutable ledger rows'
);

select * from finish();

rollback;

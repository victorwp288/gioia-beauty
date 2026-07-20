begin;
grant gioia_migrator to postgres;
grant usage on schema extensions to gioia_migrator;
set local search_path = extensions, public, pg_catalog;
select plan(25);

select ok(
  has_function_privilege(
    'gioia_migrator',
    'gioia_private.begin_legacy_migration_import(uuid,text,bytea,smallint)',
    'EXECUTE'
  ) and not has_function_privilege(
    'app_runtime',
    'gioia_private.begin_legacy_migration_import(uuid,text,bytea,smallint)',
    'EXECUTE'
  ),
  'only the isolated migrator can enter the import boundary'
);

select ok(
  not has_table_privilege(
    'gioia_migrator', 'gioia_private.schedule_entries', 'INSERT,UPDATE,DELETE'
  ) and not has_table_privilege(
    'gioia_migrator', 'gioia_private.vacations', 'INSERT,UPDATE,DELETE'
  ) and not has_table_privilege(
    'gioia_migrator', 'gioia_private.newsletter_subscribers',
    'INSERT,UPDATE,DELETE'
  ) and has_table_privilege(
    'gioia_migrator', 'gioia_private.domain_change_log', 'INSERT,SELECT'
  ) and not has_table_privilege(
    'gioia_migrator', 'gioia_private.domain_change_log', 'UPDATE,DELETE'
  ),
  'migrator has no target DML and keeps append-only migration audit access'
);

select ok(
  not has_table_privilege(
    'gioia_mutator', 'gioia_private.migration_runs', 'INSERT,UPDATE,DELETE'
  ) and not has_table_privilege(
    'gioia_mutator', 'gioia_private.migration_records', 'INSERT,UPDATE,DELETE'
  ) and not has_table_privilege(
    'gioia_mutator', 'gioia_private.migration_quarantine', 'INSERT,UPDATE,DELETE'
  ),
  'ordinary mutation functions have no broad direct migration-ledger DML'
);

set local role gioia_migrator;
select throws_ok(
  $$select gioia_private.begin_legacy_migration_import(
    'a5000000-0000-4000-8000-000000000099','synthetic-local',
    decode(repeat('01',32),'hex'),101::smallint
  )$$,
  'PT422', 'MIGRATION_IMPORT_INVALID',
  'the database rejects a batch above the hard 100-record limit'
);

select is(
  gioia_private.begin_legacy_migration_import(
    'a5000000-0000-4000-8000-000000000001','synthetic-local',
    decode(repeat('11',32),'hex'),4::smallint
  ), true,
  'a bounded synthetic import run starts'
);

select is(
  gioia_private.apply_legacy_schedule_import(
    'a5000000-0000-4000-8000-000000000001','legacy-block-1',
    decode(repeat('21',32),'hex'),decode(repeat('31',32),'hex'),
    'a5000000-0000-4000-8000-000000000011','legacy-block-1',
    'block','active','2030-01-07',600::smallint,60::smallint,0::smallint,
    null,null,null,null,null,null,null,null,null,null,'Synthetic import block',
    null,null,null,'import_time','2026-07-20T10:00:00Z',
    '2026-07-20T10:00:00Z','2026-07-20T10:00:00Z',1
  ), true,
  'a schedule row and evidence are imported through the narrow function'
);

reset role;
select results_eq(
  $$select source,legacy_firestore_id,timestamp_provenance,imported_at is not null
    from gioia_private.schedule_entries
    where id='a5000000-0000-4000-8000-000000000011'$$,
  $$values ('migration'::text,'legacy-block-1'::text,'import_time'::text,true)$$,
  'schedule target preserves legacy identity and timestamp provenance'
);
select results_eq(
  $$select encode(source_record_sha256,'hex'),encode(target_record_sha256,'hex')
    from gioia_private.migration_records
    where run_id='a5000000-0000-4000-8000-000000000001'
      and source_record_id='legacy-block-1'$$,
  $$values (repeat('21',32),repeat('31',32))$$,
  'the ledger preserves source and target checksums without payload'
);
select is(
  (select count(*) from gioia_private.domain_change_log
   where aggregate_id='a5000000-0000-4000-8000-000000000011'
     and source='migration'),
  1::bigint,
  'a new target creates exactly one migration domain event'
);

set local role gioia_migrator;
select is(
  gioia_private.apply_legacy_schedule_import(
    'a5000000-0000-4000-8000-000000000001','legacy-block-1',
    decode(repeat('21',32),'hex'),decode(repeat('31',32),'hex'),
    'a5000000-0000-4000-8000-000000000011','legacy-block-1',
    'block','active','2030-01-07',600::smallint,60::smallint,0::smallint,
    null,null,null,null,null,null,null,null,null,null,'Synthetic import block',
    null,null,null,'import_time','2026-07-20T10:00:00Z',
    '2026-07-20T10:00:00Z','2026-07-20T10:00:00Z',1
  ), false,
  'the exact schedule record replays without another target'
);
select throws_ok(
  $$select gioia_private.apply_legacy_schedule_import(
    'a5000000-0000-4000-8000-000000000001','legacy-block-1',
    decode(repeat('22',32),'hex'),decode(repeat('31',32),'hex'),
    'a5000000-0000-4000-8000-000000000011','legacy-block-1',
    'block','active','2030-01-07',600::smallint,60::smallint,0::smallint,
    null,null,null,null,null,null,null,null,null,null,'Synthetic import block',
    null,null,null,'import_time','2026-07-20T10:00:00Z',
    '2026-07-20T10:00:00Z','2026-07-20T10:00:00Z',1
  )$$,
  'PT409','MIGRATION_SOURCE_CHECKSUM_CHANGED',
  'a changed source checksum fails closed'
);

select is(
  gioia_private.apply_legacy_vacation_import(
    'a5000000-0000-4000-8000-000000000001','legacy-vacation-1',
    decode(repeat('23',32),'hex'),decode(repeat('33',32),'hex'),
    'a5000000-0000-4000-8000-000000000012','legacy-vacation-1',
    '2031-02-03','2031-02-04','active','Synthetic closure',null,
    'import_time','2026-07-20T10:00:00Z','2026-07-20T10:00:00Z',
    '2026-07-20T10:00:00Z',1
  ), true,
  'a vacation imports through its strict target function'
);
select is(
  gioia_private.apply_legacy_subscriber_import(
    'a5000000-0000-4000-8000-000000000001','legacy-subscriber-1',
    decode(repeat('24',32),'hex'),decode(repeat('34',32),'hex'),
    'a5000000-0000-4000-8000-000000000013','legacy-subscriber-1',
    'synthetic-import@gioia.test','legacy_unverified',null,null,null,null,null,
    'import_time','2026-07-20T10:00:00Z','2026-07-20T10:00:00Z',
    '2026-07-20T10:00:00Z',1
  ), true,
  'a consent-safe legacy subscriber imports through its strict target function'
);
select is(
  gioia_private.apply_legacy_quarantine_import(
    'a5000000-0000-4000-8000-000000000001','customers','legacy-bad-1',
    decode(repeat('25',32),'hex'),'INVALID_SOURCE_SHAPE',
    array['CUSTOMER_DOCUMENT']::text[]
  ), true,
  'a rejected source records only reason and field codes'
);

select results_eq(
  $$select source_count,imported_count,quarantined_count
    from gioia_private.complete_legacy_migration_import(
      'a5000000-0000-4000-8000-000000000001'
    )$$,
  $$values (4,3,1)$$,
  'completion atomically reconciles the bounded run counts'
);

reset role;
select results_eq(
  $$select status,counts from gioia_private.migration_runs
    where id='a5000000-0000-4000-8000-000000000001'$$,
  $$values (
    'completed'::text,
    '{"source":4,"imported":3,"quarantined":1}'::jsonb
  )$$,
  'completed run stores aggregate counts only'
);
select is(
  (select count(*) from gioia_private.migration_records
   where run_id='a5000000-0000-4000-8000-000000000001'),
  4::bigint,
  'the run records one disposition per bounded source record'
);
select is(
  (select count(*) from gioia_private.domain_change_log
   where migration_run_id='a5000000-0000-4000-8000-000000000001'),
  3::bigint,
  'only imported targets create PII-free domain events'
);
select results_eq(
  $$select reason_code,field_codes,resolved_at is null
    from gioia_private.migration_quarantine
    where run_id='a5000000-0000-4000-8000-000000000001'$$,
  $$values (
    'INVALID_SOURCE_SHAPE'::text,array['CUSTOMER_DOCUMENT']::text[],true
  )$$,
  'quarantine contains classification evidence and no source payload'
);
select is(
  (select count(*) from information_schema.columns
   where table_schema='gioia_private'
     and table_name in ('migration_runs','migration_records','migration_quarantine')
     and column_name ~ '(payload|document|record_data|customer_data)'),
  0::bigint,
  'migration ledgers expose no payload column'
);

set local role gioia_migrator;
select is(
  gioia_private.begin_legacy_migration_import(
    'a5000000-0000-4000-8000-000000000001','synthetic-local',
    decode(repeat('11',32),'hex'),4::smallint
  ), false,
  'an exact completed run begins as an idempotent replay'
);
select is(
  gioia_private.apply_legacy_schedule_import(
    'a5000000-0000-4000-8000-000000000001','legacy-block-1',
    decode(repeat('21',32),'hex'),decode(repeat('31',32),'hex'),
    'a5000000-0000-4000-8000-000000000011','legacy-block-1',
    'block','active','2030-01-07',600::smallint,60::smallint,0::smallint,
    null,null,null,null,null,null,null,null,null,null,'Synthetic import block',
    null,null,null,'import_time','2026-07-20T10:00:00Z',
    '2026-07-20T10:00:00Z','2026-07-20T10:00:00Z',1
  ), false,
  'a completed exact record remains replay-only'
);
select results_eq(
  $$select source_count,imported_count,quarantined_count
    from gioia_private.complete_legacy_migration_import(
      'a5000000-0000-4000-8000-000000000001'
    )$$,
  $$values (4,3,1)$$,
  'completion itself is idempotent'
);

reset role;
select is(
  (select count(*) from gioia_private.schedule_entries
   where legacy_firestore_id='legacy-block-1'),
  1::bigint,
  'full replay leaves one target row'
);
select is(
  (select count(*) from gioia_private.domain_change_log
   where aggregate_id='a5000000-0000-4000-8000-000000000011'),
  1::bigint,
  'full replay leaves one domain event'
);

select * from finish();
rollback;

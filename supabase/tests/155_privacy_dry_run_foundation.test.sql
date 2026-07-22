begin;
grant gioia_migrator to postgres;
grant gioia_mutator to postgres;
set local search_path = extensions, public, pg_catalog;
select plan(23);
select is(
  (select count(*) from pg_catalog.pg_class as relation
    join pg_catalog.pg_namespace as namespace on namespace.oid = relation.relnamespace
    where namespace.nspname = 'gioia_private' and relation.relname in (
      'privacy_policy_versions','privacy_policy_decisions','privacy_subject_requests',
      'privacy_holds','privacy_request_inventory','privacy_scrub_plan_items',
      'privacy_operation_evidence') and relation.relkind = 'r'),
  7::bigint,
  'privacy foundation creates exactly seven private tables'
);
select is(
  (select count(*) from gioia_private.privacy_policy_versions),
  0::bigint,
  'migration invents no approved or draft policy'
);
select ok(
  not has_table_privilege('app_runtime', 'gioia_private.privacy_subject_requests', 'SELECT')
    and not has_table_privilege('anon', 'gioia_private.privacy_subject_requests', 'SELECT')
    and not has_table_privilege('authenticated', 'gioia_private.privacy_subject_requests', 'SELECT')
    and not has_table_privilege('service_role', 'gioia_private.privacy_subject_requests', 'SELECT'),
  'runtime and Data API roles have no privacy-table access'
);
set local role gioia_migrator;
insert into gioia_private.privacy_policy_versions (
  policy_version, environment, target_id, artifact_sha256
) values (
  'privacy-pending-v1', 'local', 'gioia-beauty-local', decode(repeat('11', 32), 'hex')
);
reset role;
select throws_ok(
  $$select * from gioia_private.inventory_privacy_subject_dry_run(
    '10000000-0000-4000-8000-000000000001','privacy-pending-v1','local',
    'gioia-beauty-local','access','subject@privacy.test',null,null,
    decode(repeat('12',32),'hex'),decode(repeat('13',32),'hex'),
    statement_timestamp(),100::smallint)$$,
  'PT503', 'PRIVACY_POLICY_NOT_APPROVED',
  'pending policy makes inventory inert'
);
select is(
  (select count(*) from gioia_private.privacy_subject_requests),
  0::bigint,
  'rejected inventory writes no request or evidence'
);
insert into auth.users (
  instance_id,id,aud,role,email,email_confirmed_at,
  raw_app_meta_data,raw_user_meta_data,created_at,updated_at
) values (
  '00000000-0000-0000-0000-000000000000',
  '50000000-0000-4000-8000-000000000001','authenticated','authenticated',
  'subject@privacy.test',statement_timestamp(),
  '{"provider":"email","providers":["email"]}'::jsonb,'{}'::jsonb,
  statement_timestamp(),statement_timestamp()
);
set local role gioia_migrator;
insert into gioia_private.privacy_policy_versions (
  policy_version, environment, target_id, artifact_sha256
) values (
  'privacy-synthetic-v1', 'local', 'gioia-beauty-local',
  decode(repeat('21',32),'hex')
);
insert into gioia_private.privacy_policy_decisions (
  policy_version, decision_id, status, decision_artifact_sha256, decided_at
)
select 'privacy-synthetic-v1', decision_id, 'approved',
  decode(repeat('23',32),'hex'), statement_timestamp()
from unnest(array[
  'RET-01','RET-02','RET-03','RET-04','RET-05','RET-06','RET-07',
  'RET-08','RET-09','RET-10','RET-11','RET-12','RET-13','RET-14',
  'RET-15','RET-16','RET-17','RET-HOLD'
]) as decision(decision_id);
update gioia_private.privacy_policy_versions
set status = 'approved', approved_at = statement_timestamp(),
  approval_evidence_sha256 = decode(repeat('22',32),'hex')
where policy_version = 'privacy-synthetic-v1';
reset role;
set local role gioia_mutator;
insert into gioia_private.schedule_entries (
  id, kind, status, source, local_date, start_minutes,
  service_duration_minutes, buffer_minutes, service_id, variant_id,
  service_name_snapshot, variant_name_snapshot, client_name, client_email,
  client_phone, client_note
) values (
  '20000000-0000-4000-8000-000000000001', 'appointment', 'confirmed',
  'public', '2035-11-05', 600, 30, 5, 'manicure', 'manicure-30-min',
  'Manicure', 'Manicure', 'Synthetic Subject', 'subject@privacy.test',
  '+390000000000', 'synthetic privacy fixture'
);
insert into gioia_private.newsletter_subscribers (
  id, email, status, source, consent_at, consent_source, consent_policy_version
) values (
  '30000000-0000-4000-8000-000000000001', 'subject@privacy.test',
  'pending', 'public', statement_timestamp(), 'public_form',
  'newsletter-consent-v1'
);
insert into gioia_private.email_outbox (
  aggregate_kind, aggregate_id, aggregate_version, recipient_kind,
  recipient_address, template_kind, template_data, idempotency_key
) values (
  'schedule_entry', '20000000-0000-4000-8000-000000000001', 1,
  'customer', 'subject@privacy.test', 'booking_customer',
  '{"client_name":"Synthetic Subject","local_date":"2035-11-05",
    "start_minutes":600,"service_duration_minutes":30,
    "service_name":"Manicure","variant_name":"Manicure"}'::jsonb,
  'privacy:outbox:fixture'
);
reset role;
select results_eq(
  $$select * from gioia_private.inventory_privacy_subject_dry_run(
    '10000000-0000-4000-8000-000000000002','privacy-synthetic-v1','local',
    'gioia-beauty-local','access','subject@privacy.test','+390000000000',
    '20000000-0000-4000-8000-000000000001',decode(repeat('31',32),'hex'),
    decode(repeat('32',32),'hex'),statement_timestamp(),100::smallint)$$,
  $$values
    ('command_requests'::text,0,false),('domain_change_log'::text,0,false),
    ('email_outbox'::text,1,false),('email_webhook_events'::text,0,false),
    ('migration_evidence'::text,0,false),
    ('newsletter_subscribers'::text,1,false),('owner_auth'::text,1,false),
    ('schedule_entries'::text,1,false)$$,
  'approved complete policy permits an eight-store bounded access inventory'
);
select results_eq(
  $$select request_kind, status, selector_count,
      octet_length(selector_manifest_sha256), octet_length(identity_evidence_sha256)
    from gioia_private.privacy_subject_requests
    where case_id = '10000000-0000-4000-8000-000000000002'$$,
  $$values ('access'::text,'inventory_ready'::text,3::smallint,32,32)$$,
  'inventory persists only bounded metadata and evidence digests'
);
select is(
  (select count(*) from gioia_private.privacy_operation_evidence
    where case_id = '10000000-0000-4000-8000-000000000002'
      and event_kind = 'inventory_created'),
  1::bigint,
  'inventory emits one immutable fixed-shape evidence row'
);
select throws_ok(
  $$select * from gioia_private.plan_privacy_scrub_dry_run(
    '10000000-0000-4000-8000-000000000002',10000)$$,
  'PT409', 'PRIVACY_REQUEST_NOT_PLANNABLE',
  'access requests cannot be converted into scrub plans'
);
select lives_ok(
  $$select * from gioia_private.inventory_privacy_subject_dry_run(
    '10000000-0000-4000-8000-000000000003','privacy-synthetic-v1','local',
    'gioia-beauty-local','erasure','subject@privacy.test','+390000000000',
    '20000000-0000-4000-8000-000000000001',decode(repeat('33',32),'hex'),
    decode(repeat('34',32),'hex'),statement_timestamp(),100::smallint)$$,
  'the same exact selectors can create a separate erasure dry run'
);
set local role gioia_migrator;
insert into gioia_private.privacy_policy_versions (
  policy_version, environment, target_id, artifact_sha256
) values (
  'privacy-other-v1','test','other-test',decode(repeat('41',32),'hex')
);
select throws_ok(
  $$insert into gioia_private.privacy_holds (
    case_id,policy_version,scope_code,purpose_evidence_sha256,
    starts_at,review_at,expires_at
  ) values (
    '10000000-0000-4000-8000-000000000003','privacy-other-v1',
    'all_subject_records',decode(repeat('42',32),'hex'),statement_timestamp(),
    statement_timestamp()+interval '1 day',statement_timestamp()+interval '2 days')$$,
  '23503', null,
  'a hold cannot cite a policy other than its request policy'
);

insert into gioia_private.privacy_holds (
  hold_id,case_id,policy_version,scope_code,purpose_evidence_sha256,
  starts_at,review_at,expires_at
) values (
  '40000000-0000-4000-8000-000000000001',
  '10000000-0000-4000-8000-000000000003','privacy-synthetic-v1',
  'all_subject_records',decode(repeat('43',32),'hex'),statement_timestamp(),
  statement_timestamp()+interval '1 day',statement_timestamp()+interval '2 days'
);
reset role;

select throws_ok(
  $$select * from gioia_private.plan_privacy_scrub_dry_run(
    '10000000-0000-4000-8000-000000000003',10000)$$,
  'PT409', 'PRIVACY_HOLD_ACTIVE',
  'an active exact-case hold blocks scrub planning'
);

set local role gioia_migrator;
update gioia_private.privacy_holds
set released_at = statement_timestamp()
where hold_id = '40000000-0000-4000-8000-000000000001';
reset role;

select is(
  (select count(*) from gioia_private.plan_privacy_scrub_dry_run(
    '10000000-0000-4000-8000-000000000003',10000)),
  8::bigint,
  'released hold permits an eight-store dry-run scrub plan'
);

select results_eq(
  $$select matched_rows, field_codes, decision_ids
    from gioia_private.privacy_scrub_plan_items
    where case_id = '10000000-0000-4000-8000-000000000003'
      and store_name = 'schedule_entries'$$,
  $$values (1,array['client_name','client_email','client_phone','client_note',
    'internal_note','cancellation_reason','legacy_firestore_id']::text[],
    array['RET-01','RET-02','RET-03','RET-10']::text[])$$,
  'scrub plan identifies fields and unresolved decision IDs without disposition'
);

select results_eq(
  $$select client_name, client_email::text, client_phone, client_note
    from gioia_private.schedule_entries
    where id = '20000000-0000-4000-8000-000000000001'$$,
  $$values ('Synthetic Subject'::text,'subject@privacy.test'::text,
    '+390000000000'::text,'synthetic privacy fixture'::text)$$,
  'scrub planning never mutates subject data'
);

select is(
  (select email::text from auth.users
    where id = '50000000-0000-4000-8000-000000000001'),
  'subject@privacy.test'::text,
  'scrub planning never mutates the bounded Auth subject'
);

select is(
  (select count(*) from gioia_private.plan_privacy_scrub_dry_run(
    '10000000-0000-4000-8000-000000000003',10000)),
  8::bigint,
  'scrub planning replays without duplicate plan or evidence writes'
);

select results_eq(
  $$select status, count(*) from gioia_private.privacy_operation_evidence
    join gioia_private.privacy_subject_requests using (case_id,policy_version)
    where case_id = '10000000-0000-4000-8000-000000000003'
    group by status$$,
  $$values ('scrub_planned'::text,2::bigint)$$,
  'one inventory and one scrub-plan evidence row remain after replay'
);

set local role gioia_migrator;
select lives_ok(
  $$update gioia_private.privacy_policy_versions set status = 'retired'
    where policy_version = 'privacy-synthetic-v1'$$,
  'an approved policy can make the exact lifecycle transition to retired'
);
select throws_ok(
  $$update gioia_private.privacy_policy_versions
    set artifact_sha256 = decode(repeat('98',32),'hex')
    where policy_version = 'privacy-synthetic-v1'$$,
  'PT409', 'PRIVACY_POLICY_IMMUTABLE',
  'a retired policy version is immutable'
);

select throws_ok(
  $$update gioia_private.privacy_policy_decisions
    set decision_artifact_sha256 = decode(repeat('99',32),'hex')
    where policy_version = 'privacy-synthetic-v1' and decision_id = 'RET-01'$$,
  'PT409', 'PRIVACY_DECISION_IMMUTABLE',
  'decisions are immutable once their policy version is approved'
);
reset role;

select ok(
  pg_get_functiondef(
    'gioia_private.inventory_privacy_subject_dry_run(uuid,text,text,text,text,text,text,uuid,bytea,bytea,timestamp with time zone,smallint)'::regprocedure
  ) ~* 'limit p_max_rows_per_store [+] 1'
    and pg_get_functiondef(
      'gioia_private.plan_privacy_scrub_dry_run(uuid,integer)'::regprocedure
    ) !~* 'update gioia_private[.](schedule_entries|newsletter_subscribers|email_outbox)',
  'database functions bound inventory and expose no subject-data mutation path'
);

select ok(
  not has_function_privilege(
    'app_runtime',
    'gioia_private.inventory_privacy_subject_dry_run(uuid,text,text,text,text,text,text,uuid,bytea,bytea,timestamp with time zone,smallint)',
    'EXECUTE')
    and not has_function_privilege(
      'service_role','gioia_private.plan_privacy_scrub_dry_run(uuid,integer)',
      'EXECUTE')
    and not has_function_privilege(
      'app_runtime',
      'gioia_private.count_privacy_owner_auth_dry_run(text,smallint)',
      'EXECUTE')
    and not has_function_privilege(
      'service_role',
      'gioia_private.count_privacy_owner_auth_dry_run(text,smallint)',
      'EXECUTE'),
  'application and Data API roles cannot execute privacy operator functions'
);

select * from finish();
rollback;

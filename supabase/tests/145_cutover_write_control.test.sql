begin;
grant app_runtime to postgres;
grant gioia_mutator to postgres;
grant usage on schema extensions to app_runtime;
set local search_path = extensions, public, pg_catalog;
select plan(24);
select results_eq(
  $$select mode, version from gioia_private.get_cutover_write_state()$$,
  $$values ('open'::text, 1::integer)$$,
  'cutover write control starts open'
);

select ok(
  has_function_privilege(
    'app_runtime',
    'gioia_private.authorize_cutover_write(text,text,bytea,text)', 'EXECUTE'
  ) and not has_function_privilege(
    'app_runtime', 'gioia_private.begin_cutover_write_freeze(text)', 'EXECUTE'
  ) and not has_function_privilege(
    'app_runtime', 'gioia_private.begin_command(text,bytea,text,bytea)', 'EXECUTE'
  ),
  'runtime can authorize writes but cannot operate lifecycle or command internals'
);

set local role gioia_mutator;
do $freeze$
declare v_freeze_id uuid; v_version integer;
begin
  select freeze_id, version into strict v_freeze_id, v_version
  from gioia_private.begin_cutover_write_freeze('TEST_FREEZE');
  perform set_config('gioia.test_freeze_id', v_freeze_id::text, true);
  perform set_config('gioia.test_freeze_version', v_version::text, true);
end
$freeze$;

reset role;
select is(
  (select mode from gioia_private.get_cutover_write_state()),
  'frozen'::text,
  'the operator can begin a write freeze'
);

set local role gioia_mutator;
select throws_ok(
  $$select * from gioia_private.begin_command(
    'public_booking', decode(repeat('11',32),'hex'),
    'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', decode(repeat('21',32),'hex')
  )$$,
  'PT503', 'MAINTENANCE_ACTIVE',
  'direct internal command execution cannot bypass a freeze'
);

reset role;
set local role app_runtime;
select throws_ok(
  $$select * from gioia_private.authorize_cutover_write(
    'public_booking', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
    decode(repeat('21',32),'hex'), null
  )$$,
  'PT503', 'MAINTENANCE_ACTIVE',
  'ordinary public writes fail closed during a freeze'
);

reset role;
set local role gioia_mutator;
do $grant$
declare v_run_id uuid; v_grant_id uuid;
begin
  v_run_id := gioia_private.begin_cutover_canary_run(
    current_setting('gioia.test_freeze_id')::uuid,
    'TEST_CANARY', statement_timestamp() + interval '20 minutes'
  );
  v_grant_id := gioia_private.issue_cutover_canary_grant(
    v_run_id, extensions.digest(repeat('A',43), 'sha256'),
    'public_booking', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
    decode(repeat('21',32),'hex'), statement_timestamp() + interval '10 minutes'
  );
  perform set_config('gioia.test_canary_run_id', v_run_id::text, true);
  perform set_config('gioia.test_canary_grant_id', v_grant_id::text, true);
end
$grant$;

reset role;
set local role app_runtime;
select throws_ok(
  $$select * from gioia_private.authorize_cutover_write(
    'public_booking', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
    decode(repeat('21',32),'hex'), repeat('B',43)
  )$$,
  'PT503', 'MAINTENANCE_ACTIVE',
  'an unknown canary token fails closed'
);

select results_eq(
  $$select is_canary, canary_run_id::text, canary_grant_id::text
    from gioia_private.authorize_cutover_write(
      'public_booking', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
      decode(repeat('21',32),'hex'), repeat('A',43)
    )$$,
  $$values (
    true, current_setting('gioia.test_canary_run_id'),
    current_setting('gioia.test_canary_grant_id')
  )$$,
  'the exact short-lived canary grant authorizes one scoped mutation'
);

reset role;

set local role gioia_mutator;

select results_eq(
  $$select replayed from gioia_private.begin_command(
    'public_booking', decode(repeat('11',32),'hex'),
    'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', decode(repeat('21',32),'hex')
  )$$,
  $$values (false)$$,
  'the database command boundary accepts the exact authorization proof'
);

reset role;

select is(
  (select count(*) from gioia_private.cutover_canary_events
    where run_id = current_setting('gioia.test_canary_run_id')::uuid),
  1::bigint,
  'canary authorization creates one durable audit event'
);

set local role gioia_mutator;

select throws_ok(
  format(
    'select gioia_private.reconcile_cutover_canary_run(%L::uuid)',
    current_setting('gioia.test_canary_run_id')
  ),
  'P0001', 'Canary commands have not completed',
  'a run cannot reconcile before its authorized command completes'
);

reset role;

set local role gioia_mutator;

select lives_ok(
  $$select gioia_private.complete_command(
      (
        select id from gioia_private.command_requests
        where operation='public_booking'
          and idempotency_key='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
      ),
      200::smallint, 'synthetic_canary',
      '98000000-0000-4000-8000-000000000000'::uuid,
      'CANARY_TEST_COMPLETE'
    )$$,
  'the synthetic canary command is marked complete for reconciliation'
);

reset role;

set local role app_runtime;

select lives_ok(
  $$select * from gioia_private.authorize_cutover_write(
    'public_booking', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
    decode(repeat('21',32),'hex'), repeat('A',43)
  )$$,
  'an exact idempotent replay may reuse its consumed canary grant'
);

select throws_ok(
  $$select * from gioia_private.authorize_cutover_write(
    'public_booking', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
    decode(repeat('22',32),'hex'), repeat('A',43)
  )$$,
  'PT503', 'MAINTENANCE_ACTIVE',
  'a consumed token cannot drift to another request fingerprint'
);

reset role;

select is(
  (select count(*) from gioia_private.cutover_canary_events
    where run_id = current_setting('gioia.test_canary_run_id')::uuid),
  1::bigint,
  'canary replay does not duplicate the authorization audit event'
);

select lives_ok(
  $$insert into gioia_private.email_outbox (
    aggregate_kind, aggregate_id, aggregate_version, recipient_kind,
    recipient_address, template_kind, template_data, idempotency_key
  ) values (
    'schedule_entry', '98000000-0000-4000-8000-000000000001', 1, 'owner',
    'owner@canary.test', 'booking_owner', '{}', 'canary:suppressed:0001'
  )$$,
  'canary outbox insertion is safely intercepted'
);

select is(
  (select count(*) from gioia_private.email_outbox
    where idempotency_key = 'canary:suppressed:0001'),
  0::bigint,
  'canary commands cannot send email'
);

set local role gioia_mutator;

select lives_ok(
  format(
    'select gioia_private.reconcile_cutover_canary_run(%L::uuid)',
    current_setting('gioia.test_canary_run_id')
  ),
  'a completed and cleaned synthetic run can reconcile'
);

do $owner_reconcile$
declare v_version integer;
begin
  v_version := gioia_private.enter_cutover_owner_reconcile(
    current_setting('gioia.test_freeze_id')::uuid,
    current_setting('gioia.test_freeze_version')::integer,
    'TEST_OWNER_RECONCILE'
  );
  perform set_config('gioia.test_reconcile_version', v_version::text, true);
end
$owner_reconcile$;

reset role;

select is(
  (select mode from gioia_private.get_cutover_write_state()),
  'owner_reconcile'::text,
  'the operator can enter owner-only manual reconciliation'
);

set local role app_runtime;

select throws_ok(
  $$select * from gioia_private.authorize_cutover_write(
    'public_booking', 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
    decode(repeat('31',32),'hex'), null
  )$$,
  'PT503', 'MAINTENANCE_ACTIVE',
  'public writes remain blocked during owner reconciliation'
);

select lives_ok(
  $$select * from gioia_private.authorize_cutover_write(
    'owner_create_appointment', 'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
    decode(repeat('41',32),'hex'), null
  )$$,
  'an owner backlog command can be authorized during reconciliation'
);

reset role;

select lives_ok(
  $$insert into gioia_private.email_outbox (
    aggregate_kind, aggregate_id, aggregate_version, recipient_kind,
    recipient_address, template_kind, template_data, idempotency_key
  ) values (
    'schedule_entry', '98000000-0000-4000-8000-000000000002', 1, 'owner',
    'owner@reconcile.test', 'booking_owner', '{}', 'reconcile:suppressed:0001'
  )$$,
  'owner-reconciliation outbox insertion is safely intercepted'
);

select is(
  (select count(*) from gioia_private.email_outbox
    where idempotency_key = 'reconcile:suppressed:0001'),
  0::bigint,
  'manual backlog entry cannot send unexpected email'
);

set local role gioia_mutator;

select lives_ok(
  format(
    'select gioia_private.complete_cutover_unfreeze(%L::uuid,%s,%L)',
    current_setting('gioia.test_freeze_id'),
    current_setting('gioia.test_reconcile_version'), 'TEST_UNFREEZE'
  ),
  'the reconciled freeze can be reopened'
);

reset role;

select is(
  (select mode from gioia_private.get_cutover_write_state()),
  'open'::text,
  'cutover writes reopen only after reconciliation'
);

select * from finish();
rollback;

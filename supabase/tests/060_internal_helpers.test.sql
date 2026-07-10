begin;
grant gioia_mutator to postgres;

set local search_path = extensions, public, pg_catalog;

select plan(23);
select is(
  (
    select count(*)
    from pg_catalog.pg_proc as procedure
    join pg_catalog.pg_namespace as namespace on namespace.oid = procedure.pronamespace
    where namespace.nspname = 'gioia_private'
      and procedure.proname in (
        'assert_enabled_owner', 'lock_schedule_dates',
        'assert_schedule_date_open', 'assert_vacation_span_clear'
      )
  ),
  4::bigint,
  'all four internal authorization and schedule helpers exist'
);

select is(
  (
    select count(*)
    from pg_catalog.pg_proc as procedure
    join pg_catalog.pg_namespace as namespace on namespace.oid = procedure.pronamespace
    join pg_catalog.pg_roles as owner on owner.oid = procedure.proowner
    where namespace.nspname = 'gioia_private'
      and procedure.proname in (
        'assert_enabled_owner', 'lock_schedule_dates',
        'assert_schedule_date_open', 'assert_vacation_span_clear'
      )
      and owner.rolname = 'gioia_mutator'
  ),
  4::bigint,
  'internal command helpers are owned by the no-login mutator role'
);

select ok(
  not exists (
    select 1
    from pg_catalog.pg_proc as procedure
    join pg_catalog.pg_namespace as namespace on namespace.oid = procedure.pronamespace
    join pg_catalog.pg_roles as owner on owner.oid = procedure.proowner
    where namespace.nspname = 'gioia_private'
      and procedure.prosecdef
      and (
        owner.rolname <> 'gioia_mutator'
        or not has_function_privilege('app_runtime', procedure.oid, 'EXECUTE')
      )
  ),
  'every security-definer function is a mutator-owned app_runtime entry point'
);

select ok(
  not exists (
    select 1
    from pg_catalog.pg_proc as procedure
    join pg_catalog.pg_namespace as namespace on namespace.oid = procedure.pronamespace
    where namespace.nspname = 'gioia_private'
      and not exists (
        select 1 from unnest(procedure.proconfig) as setting
        where setting like 'search_path=%'
      )
  ),
  'every private function pins its search path'
);

select ok(
  not exists (
    select 1
    from pg_catalog.pg_proc as procedure
    join pg_catalog.pg_namespace as namespace on namespace.oid = procedure.pronamespace
    cross join lateral pg_catalog.aclexplode(
      coalesce(procedure.proacl, pg_catalog.acldefault('f', procedure.proowner))
    ) as access
    left join pg_catalog.pg_roles as grantee on grantee.oid = access.grantee
    where namespace.nspname = 'gioia_private'
      and access.privilege_type = 'EXECUTE'
      and (access.grantee = 0 or grantee.rolname in (
        'anon', 'authenticated', 'service_role'
      ))
  ),
  'PUBLIC and browser/API roles cannot execute private functions'
);

select results_eq(
  $actual$
    select procedure.proname::text collate "default"
    from pg_catalog.pg_proc as procedure
    join pg_catalog.pg_namespace as namespace on namespace.oid = procedure.pronamespace
    where namespace.nspname = 'gioia_private'
      and has_function_privilege('app_runtime', procedure.oid, 'EXECUTE')
    order by procedure.proname::text collate "default"
  $actual$,
  $expected$
    values
      ('authorize_owner_session'::text),
      ('claim_email_outbox'::text),
      ('complete_email_outbox_failure'::text),
      ('complete_email_outbox_success'::text),
      ('confirm_public_newsletter'::text),
      ('create_public_booking'::text),
      ('get_public_availability'::text),
      ('owner_cancel_schedule_entry'::text),
      ('owner_cancel_vacation'::text),
      ('owner_create_appointment'::text),
      ('owner_create_block'::text),
      ('owner_create_vacation'::text),
      ('owner_reschedule_appointment'::text),
      ('owner_reschedule_block'::text),
      ('owner_set_appointment_status'::text),
      ('owner_update_appointment_details'::text),
      ('owner_update_block_details'::text),
      ('process_verified_email_webhook'::text),
      ('retry_email_outbox_as_owner'::text),
      ('revoke_owner_session'::text),
      ('start_owner_session'::text),
      ('subscribe_public_newsletter'::text),
      ('unsubscribe_public_newsletter'::text)
  $expected$,
  'app_runtime can execute only reviewed bounded entry points'
);
select is(
  (
    select count(*)
    from pg_catalog.pg_proc as procedure
    join pg_catalog.pg_namespace as namespace on namespace.oid = procedure.pronamespace
    where namespace.nspname = 'gioia_private'
      and procedure.proname in (
        'assert_enabled_owner', 'lock_schedule_dates',
        'assert_schedule_date_open', 'assert_vacation_span_clear'
      )
      and has_function_privilege(
        'gioia_mutator', procedure.oid, 'EXECUTE'
      )
  ),
  4::bigint,
  'gioia_mutator can execute all internal command helpers'
);

select ok(
  has_function_privilege(
    'gioia_mutator', 'gioia_private.enforce_schedule_entry_transition()', 'EXECUTE'
  )
    and has_function_privilege(
      'gioia_mutator', 'gioia_private.enforce_vacation_transition()', 'EXECUTE'
    )
    and has_function_privilege(
      'gioia_mutator',
      'gioia_private.enforce_email_webhook_event_transition()', 'EXECUTE'
    )
    and has_function_privilege(
      'gioia_migrator', 'gioia_private.enforce_migration_run_transition()', 'EXECUTE'
    )
    and has_function_privilege(
      'gioia_migrator',
      'gioia_private.enforce_migration_quarantine_transition()', 'EXECUTE'
    ),
  'transition guards are executable only by their intended storage role'
);

select ok(
  pg_get_functiondef(
    'gioia_private.lock_schedule_dates(date[])'::regprocedure
  ) ~* 'order by requested.local_date'
    and pg_get_functiondef(
      'gioia_private.lock_schedule_dates(date[])'::regprocedure
    ) ~* 'order by lock.local_date',
  'schedule lock rows are inserted and acquired in deterministic date order'
);

select lives_ok(
  $sql$
    with test_user as (
      insert into auth.users (
        instance_id, id, aud, role, email, email_confirmed_at,
        raw_app_meta_data, raw_user_meta_data, created_at, updated_at
      ) values (
        '00000000-0000-0000-0000-000000000000',
        '80000000-0000-4000-8000-000000000001',
        'authenticated', 'authenticated', 'owner@helpers.test', statement_timestamp(),
        '{"provider":"email","providers":["email"]}'::jsonb,
        '{}'::jsonb, statement_timestamp(), statement_timestamp()
      ) returning id
    )
    insert into gioia_private.owner_accounts (user_id)
    select id from test_user
  $sql$,
  'synthetic owner authorization fixture is accepted'
);
insert into gioia_private.owner_sessions (session_id,user_id,expires_at) values ('85000000-0000-4000-8000-000000000001','80000000-0000-4000-8000-000000000001',statement_timestamp()+interval '1 hour');
select lives_ok(
  $sql$
    insert into gioia_private.schedule_entries (
      id, kind, status, source, local_date, start_minutes,
      service_duration_minutes, buffer_minutes, service_id, variant_id,
      service_name_snapshot, variant_name_snapshot, client_name, client_email
    ) values (
      '81000000-0000-4000-8000-000000000001',
      'appointment', 'confirmed', 'public', '2035-08-10', 600,
      30, 5, 'manicure', 'manicure-30-min', 'Manicure', 'Manicure',
      'Cliente Test', 'client@helpers.test'
    )
  $sql$,
  'synthetic occupied schedule fixture is accepted'
);

select lives_ok(
  $sql$
    insert into gioia_private.vacations (
      id, start_date, end_date, source, created_by
    ) values (
      '82000000-0000-4000-8000-000000000001',
      '2035-08-20', '2035-08-21', 'admin',
      '80000000-0000-4000-8000-000000000001'
    )
  $sql$,
  'synthetic vacation fixture is accepted'
);
do $$begin perform set_config('request.jwt.claim.session_id','85000000-0000-4000-8000-000000000001',true); end$$;
set local role gioia_mutator;

select lives_ok(
  $$select gioia_private.assert_enabled_owner(
    set_config('request.jwt.claim.sub', '80000000-0000-4000-8000-000000000001', true)::uuid
  )$$,
  'enabled owner authorization succeeds'
);

select throws_ok(
  $$select gioia_private.assert_enabled_owner(
    set_config('request.jwt.claim.sub', '80000000-0000-4000-8000-000000000099', true)::uuid
  )$$,
  'PT403', 'OWNER_AUTHORIZATION_REQUIRED',
  'unknown owner authorization fails closed'
);

select lives_ok(
  $$select gioia_private.lock_schedule_dates(array[
    '2035-08-22'::date, '2035-08-20'::date, '2035-08-10'::date,
    '2035-08-21'::date, '2035-08-10'::date
  ])$$,
  'unsorted duplicate dates are locked safely'
);

select is(
  (
    select count(*) from gioia_private.schedule_day_locks
    where local_date in ('2035-08-10', '2035-08-20', '2035-08-21', '2035-08-22')
  ),
  4::bigint,
  'date locking creates one durable mutex row per distinct date'
);

select throws_ok(
  $$select gioia_private.lock_schedule_dates(array[]::date[])$$,
  'PT400', 'SCHEDULE_DATE_REQUIRED',
  'empty date-lock requests fail closed'
);

select lives_ok(
  $$select gioia_private.assert_schedule_date_open('2035-08-22')$$,
  'a locked date outside vacation is open'
);

select throws_ok(
  $$select gioia_private.assert_schedule_date_open('2035-08-20')$$,
  'PT409', 'DATE_CLOSED_FOR_VACATION',
  'an active vacation closes its inclusive start date'
);

select lives_ok(
  $$select gioia_private.assert_vacation_span_clear('2035-08-22', '2035-08-22')$$,
  'a locked unoccupied vacation span is clear'
);

select throws_ok(
  $$select gioia_private.assert_vacation_span_clear('2035-08-10', '2035-08-10')$$,
  'PT409', 'VACATION_CONFLICTS_WITH_SCHEDULE',
  'vacation creation rejects an occupied schedule date'
);

select throws_ok(
  $$select gioia_private.assert_vacation_span_clear('2035-08-11', '2035-08-10')$$,
  'PT400', 'VACATION_DATE_RANGE_INVALID',
  'vacation helper rejects a reversed date span'
);

select throws_ok(
  $$select gioia_private.assert_vacation_span_clear('2035-01-01', '2036-01-02')$$,
  'PT400', 'VACATION_DATE_LIMIT_EXCEEDED',
  'vacation helper enforces the maximum inclusive span'
);

reset role;

select * from finish();

rollback;

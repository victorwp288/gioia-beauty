begin;

set local search_path = extensions, public, pg_catalog;

select plan(24);

create function pg_temp.add_appointment(
  p_id uuid,
  p_date date,
  p_start integer,
  p_status text default 'confirmed'
)
returns void
language sql
set search_path = ''
as $function$
  insert into gioia_private.schedule_entries (
    id, kind, status, source, local_date, start_minutes,
    service_duration_minutes, buffer_minutes, service_id, variant_id,
    service_name_snapshot, variant_name_snapshot,
    client_name, client_email, cancelled_at, cancelled_by
  ) values (
    p_id, 'appointment', p_status, 'public', p_date, p_start,
    30, 5, 'manicure', 'manicure-30-min', 'Manicure', 'Manicure',
    'Cliente Test', 'cliente@schedule.test',
    case when p_status = 'cancelled' then statement_timestamp() end,
    case when p_status = 'cancelled' then 'system' end
  );
$function$;

select lives_ok(
  $sql$
    with test_user as (
      insert into auth.users (
        instance_id, id, aud, role, email, email_confirmed_at,
        raw_app_meta_data, raw_user_meta_data, created_at, updated_at
      ) values (
        '00000000-0000-0000-0000-000000000000',
        '00000000-0000-4000-8000-000000000001',
        'authenticated', 'authenticated', 'owner@schedule.test', statement_timestamp(),
        '{"provider":"email","providers":["email"]}'::jsonb,
        '{}'::jsonb, statement_timestamp(), statement_timestamp()
      ) returning id
    )
    insert into gioia_private.owner_accounts (user_id)
    select id from test_user
  $sql$,
  'deterministic synthetic owner fixture is accepted'
);

select lives_ok(
  $$select pg_temp.add_appointment(
    '10000000-0000-4000-8000-000000000001', '2035-03-10', 540
  )$$,
  'a valid appointment is accepted'
);

select lives_ok(
  $$select pg_temp.add_appointment(
    '10000000-0000-4000-8000-000000000002', '2035-03-10', 575
  )$$,
  'an appointment adjacent to the occupied service-plus-buffer span is accepted'
);

select throws_ok(
  $$select pg_temp.add_appointment(
    '10000000-0000-4000-8000-000000000003', '2035-03-10', 540
  )$$,
  '23P01', null,
  'an exact same-slot appointment is rejected'
);

select throws_ok(
  $$select pg_temp.add_appointment(
    '10000000-0000-4000-8000-000000000004', '2035-03-10', 570
  )$$,
  '23P01', null,
  'a partially overlapping appointment is rejected'
);

select throws_ok(
  $$select pg_temp.add_appointment(
    '10000000-0000-4000-8000-000000000005', '2035-03-10', 574
  )$$,
  '23P01', null,
  'the hidden buffer participates in overlap protection'
);

select lives_ok(
  $$select pg_temp.add_appointment(
    '10000000-0000-4000-8000-000000000006', '2035-03-10', 540, 'cancelled'
  )$$,
  'cancelled appointments do not consume schedule capacity'
);

select lives_ok(
  $sql$
    insert into gioia_private.schedule_entries (
      id, kind, status, source, local_date, start_minutes,
      service_duration_minutes, buffer_minutes, internal_note, created_by
    ) values (
      '20000000-0000-4000-8000-000000000001', 'block', 'active', 'admin',
      '2035-03-11', 600, 60, 0, 'Blocco sintetico',
      '00000000-0000-4000-8000-000000000001'
    )
  $sql$,
  'a valid owner-created block is accepted'
);

select throws_ok(
  $sql$
    insert into gioia_private.schedule_entries (
      kind, status, source, local_date, start_minutes,
      service_duration_minutes, client_name, created_by
    ) values (
      'block', 'active', 'admin', '2035-03-12', 600, 30, 'Not allowed',
      '00000000-0000-4000-8000-000000000001'
    )
  $sql$,
  '23514', null,
  'blocks reject customer fields'
);

select throws_ok(
  $sql$
    insert into gioia_private.schedule_entries (
      kind, status, source, local_date, start_minutes,
      service_duration_minutes, service_id, variant_id,
      service_name_snapshot, variant_name_snapshot
    ) values (
      'appointment', 'confirmed', 'public', '2035-03-12', 600, 30,
      'manicure', 'manicure-30-min', 'Manicure', 'Manicure'
    )
  $sql$,
  '23514', null,
  'appointments require a customer name and catalog snapshots'
);

select throws_ok(
  $$select pg_temp.add_appointment(
    '10000000-0000-4000-8000-000000000007', '2035-03-12', 1430
  )$$,
  '23514', null,
  'an occupied span cannot cross the end of the local day'
);

select throws_ok(
  $sql$
    insert into gioia_private.schedule_entries (
      kind, status, source, local_date, start_minutes,
      service_duration_minutes, created_by
    ) values (
      'block', 'confirmed', 'admin', '2035-03-12', 600, 30,
      '00000000-0000-4000-8000-000000000001'
    )
  $sql$,
  '23514', null,
  'schedule status is constrained by entry kind'
);

select lives_ok(
  $sql$
    insert into gioia_private.vacations (
      id, start_date, end_date, source, created_by
    ) values (
      '30000000-0000-4000-8000-000000000001', '2035-04-20', '2035-04-21',
      'admin', '00000000-0000-4000-8000-000000000001'
    )
  $sql$,
  'a valid active vacation is accepted'
);

select throws_ok(
  $sql$
    insert into gioia_private.vacations (start_date, end_date, source, created_by)
    values (
      '2035-04-21', '2035-04-22', 'admin',
      '00000000-0000-4000-8000-000000000001'
    )
  $sql$,
  '23P01', null,
  'overlapping inclusive vacation dates are rejected'
);

select lives_ok(
  $sql$
    insert into gioia_private.vacations (start_date, end_date, source, created_by)
    values (
      '2035-04-22', '2035-04-23', 'admin',
      '00000000-0000-4000-8000-000000000001'
    )
  $sql$,
  'a vacation starting after the prior inclusive end date is accepted'
);

select throws_ok(
  $sql$
    insert into gioia_private.vacations (start_date, end_date, source, created_by)
    values (
      '2035-05-02', '2035-05-01', 'admin',
      '00000000-0000-4000-8000-000000000001'
    )
  $sql$,
  '23514', null,
  'vacation end date cannot precede its start date'
);

select throws_ok(
  $sql$
    insert into gioia_private.vacations (start_date, end_date, source, created_by)
    values (
      '2035-06-01', '2036-06-01', 'admin',
      '00000000-0000-4000-8000-000000000001'
    )
  $sql$,
  '23514', null,
  'vacations cannot exceed 366 inclusive days'
);

select lives_ok(
  $$update gioia_private.schedule_entries
    set status = 'completed'
    where id = '10000000-0000-4000-8000-000000000002'$$,
  'a confirmed appointment can transition to completed'
);

select throws_ok(
  $$update gioia_private.schedule_entries
    set start_minutes = 600
    where id = '10000000-0000-4000-8000-000000000002'$$,
  '23514', 'Terminal schedule occupancy and evidence are immutable',
  'completed appointment occupancy is immutable'
);

select throws_ok(
  $$update gioia_private.schedule_entries
    set status = 'confirmed'
    where id = '10000000-0000-4000-8000-000000000002'$$,
  '23514', 'Invalid schedule status transition',
  'terminal appointment status cannot be reversed'
);

select lives_ok(
  $$update gioia_private.schedule_entries
    set status = 'cancelled', cancelled_at = statement_timestamp(), cancelled_by = 'admin'
    where id = '20000000-0000-4000-8000-000000000001'$$,
  'an active block can transition to cancelled'
);

select lives_ok(
  $$update gioia_private.schedule_entries
    set internal_note = 'Changed'
    where id = '20000000-0000-4000-8000-000000000001'$$,
  'cancelled blocks allow non-occupancy note corrections'
);

select lives_ok(
  $$update gioia_private.vacations
    set status = 'cancelled', cancelled_at = statement_timestamp(),
      cancelled_by = '00000000-0000-4000-8000-000000000001'
    where id = '30000000-0000-4000-8000-000000000001'$$,
  'an active vacation can transition to cancelled'
);

select throws_ok(
  $$update gioia_private.vacations
    set reason = 'Changed'
    where id = '30000000-0000-4000-8000-000000000001'$$,
  '23514', 'Cancelled vacations are immutable',
  'cancelled vacations are immutable'
);

select * from finish();

rollback;

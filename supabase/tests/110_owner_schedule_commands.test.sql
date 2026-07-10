begin;

grant app_runtime to postgres;
grant usage on schema extensions to app_runtime;
set local search_path = extensions, public, pg_catalog;

select plan(27);

do $setup$
declare v_dates date[];
begin
  select array_agg(local_date order by local_date) into strict v_dates
  from (
    select day.value::date as local_date
    from generate_series(
      ((statement_timestamp() at time zone 'Europe/Rome')::date + 1)::timestamp,
      ((statement_timestamp() at time zone 'Europe/Rome')::date + 14)::timestamp,
      interval '1 day'
    ) as day(value)
    where extract(isodow from day.value) between 1 and 5
    order by day.value limit 4
  ) as candidate;
  perform set_config('gioia.test_date_a', v_dates[1]::text, true);
  perform set_config('gioia.test_date_b', v_dates[2]::text, true);
  perform set_config('gioia.test_date_c', v_dates[3]::text, true);
  perform set_config('gioia.test_date_d', v_dates[4]::text, true);
end
$setup$;

with test_user as (
  insert into auth.users (
    instance_id, id, aud, role, email, email_confirmed_at,
    raw_app_meta_data, raw_user_meta_data, created_at, updated_at
  ) values (
    '00000000-0000-0000-0000-000000000000',
    '91000000-0000-4000-8000-000000000001',
    'authenticated', 'authenticated', 'owner@schedule-command.test',
    statement_timestamp(), '{"provider":"email","providers":["email"]}'::jsonb,
    '{}'::jsonb, statement_timestamp(), statement_timestamp()
  ) returning id
)
insert into gioia_private.owner_accounts (user_id) select id from test_user;
insert into gioia_private.owner_sessions (session_id,user_id,expires_at) values ('91500000-0000-4000-8000-000000000001','91000000-0000-4000-8000-000000000001',statement_timestamp()+interval '1 hour');
insert into gioia_private.vacations (
  start_date, end_date, source, reason, created_by
) values (
  current_setting('gioia.test_date_d')::date,
  current_setting('gioia.test_date_d')::date,
  'admin', 'Fixture chiusa', '91000000-0000-4000-8000-000000000001'
);
do $$begin perform set_config('request.jwt.claim.session_id','91500000-0000-4000-8000-000000000001',true); end$$;
set local role app_runtime;

select results_eq(
  $$select http_status, result->>'code', replayed
    from gioia_private.owner_create_appointment(
      set_config('request.jwt.claim.sub',
        '91000000-0000-4000-8000-000000000001', true)::uuid,
      'owner:appointment:create:1',
      decode(repeat('a1',32),'hex'), current_setting('gioia.test_date_a')::date,
      600::smallint, 'manicure', 'manicure-30-min', ' Cliente Owner ',
      ' OWNER-CLIENT@COMMANDS.TEST ', ' +39000000199 ', ' Segreto-outbox ')$$,
  $$values (201::smallint,'APPOINTMENT_CREATED'::text,false)$$,
  'owner appointment creation succeeds'
);

select results_eq(
  $$select http_status, result->>'code', replayed
    from gioia_private.owner_create_appointment(
      '91000000-0000-4000-8000-000000000001', 'owner:appointment:create:1',
      decode(repeat('a1',32),'hex'), current_setting('gioia.test_date_a')::date,
      600::smallint, 'manicure', 'manicure-30-min', ' Cliente Owner ',
      ' OWNER-CLIENT@COMMANDS.TEST ', ' +39000000199 ', ' Segreto-outbox ')$$,
  $$values (201::smallint,'APPOINTMENT_CREATED'::text,true)$$,
  'appointment creation replays without another write'
);

reset role;
do $$begin perform set_config('gioia.test_appointment_id',(
  select resource_id::text from gioia_private.command_requests
  where idempotency_key='owner:appointment:create:1'),true); end$$;

select results_eq(
  $$select source, client_name, client_email::text, client_phone, client_note, version
    from gioia_private.schedule_entries
    where id=current_setting('gioia.test_appointment_id')::uuid$$,
  $$values ('admin'::text,'Cliente Owner'::text,'owner-client@commands.test'::text,
    '+39000000199'::text,'Segreto-outbox'::text,1)$$,
  'appointment contact fields are normalized once'
);

set local role app_runtime;
select results_eq(
  $$select http_status, result->>'code', replayed
    from gioia_private.owner_reschedule_appointment(
      '91000000-0000-4000-8000-000000000001','owner:appointment:move:1',
      decode(repeat('a2',32),'hex'),current_setting('gioia.test_appointment_id')::uuid,
      1,current_setting('gioia.test_date_b')::date,600::smallint,
      'manicure','manicure-30-min')$$,
  $$values (200::smallint,'APPOINTMENT_RESCHEDULED'::text,false)$$,
  'confirmed appointment rescheduling succeeds'
);

select is((select count(*) from gioia_private.get_public_availability(
  current_setting('gioia.test_date_a')::date,'manicure','manicure-30-min')
  where start_minutes=600),1::bigint,'rescheduling releases the original slot');
select is((select count(*) from gioia_private.get_public_availability(
  current_setting('gioia.test_date_b')::date,'manicure','manicure-30-min')
  where start_minutes=600),0::bigint,'rescheduling occupies the destination slot');

select results_eq(
  $$select http_status, result->>'code', replayed from gioia_private.owner_create_block(
    '91000000-0000-4000-8000-000000000001','owner:block:create:1',
    decode(repeat('b1',32),'hex'),current_setting('gioia.test_date_c')::date,
    600::smallint,30::smallint,0::smallint,'Blocco sintetico')$$,
  $$values (201::smallint,'BLOCK_CREATED'::text,false)$$,
  'owner block creation succeeds'
);

reset role;
do $$begin perform set_config('gioia.test_block_id',(
  select resource_id::text from gioia_private.command_requests
  where idempotency_key='owner:block:create:1'),true); end$$;
set local role app_runtime;

select results_eq(
  $$select http_status, result->>'code', replayed from gioia_private.owner_reschedule_block(
    '91000000-0000-4000-8000-000000000001','owner:block:move:1',
    decode(repeat('b2',32),'hex'),current_setting('gioia.test_block_id')::uuid,1,
    current_setting('gioia.test_date_c')::date,660::smallint,30::smallint,0::smallint)$$,
  $$values (200::smallint,'BLOCK_RESCHEDULED'::text,false)$$,
  'active block rescheduling succeeds'
);

select results_eq(
  $$select http_status,result->>'code' from gioia_private.owner_reschedule_appointment(
    '91000000-0000-4000-8000-000000000001','owner:appointment:move:stale',
    decode(repeat('a3',32),'hex'),current_setting('gioia.test_appointment_id')::uuid,
    1,current_setting('gioia.test_date_a')::date,600::smallint,'manicure','manicure-30-min')$$,
  $$values (409::smallint,'VERSION_CONFLICT'::text)$$,
  'appointment rescheduling rejects a stale version'
);
select results_eq(
  $$select http_status,result->>'code' from gioia_private.owner_reschedule_appointment(
    '91000000-0000-4000-8000-000000000001','owner:appointment:move:noop',
    decode(repeat('a4',32),'hex'),current_setting('gioia.test_appointment_id')::uuid,
    2,current_setting('gioia.test_date_b')::date,600::smallint,'manicure','manicure-30-min')$$,
  $$values (400::smallint,'RESCHEDULE_NO_CHANGE'::text)$$,
  'appointment rescheduling rejects a no-op'
);
select results_eq(
  $$select http_status,result->>'code' from gioia_private.owner_reschedule_block(
    '91000000-0000-4000-8000-000000000001','owner:block:move:stale',
    decode(repeat('b3',32),'hex'),current_setting('gioia.test_block_id')::uuid,1,
    current_setting('gioia.test_date_c')::date,690::smallint,30::smallint,0::smallint)$$,
  $$values (409::smallint,'VERSION_CONFLICT'::text)$$,
  'block rescheduling rejects a stale version'
);
select results_eq(
  $$select http_status,result->>'code' from gioia_private.owner_reschedule_block(
    '91000000-0000-4000-8000-000000000001','owner:block:move:noop',
    decode(repeat('b4',32),'hex'),current_setting('gioia.test_block_id')::uuid,2,
    current_setting('gioia.test_date_c')::date,660::smallint,30::smallint,0::smallint)$$,
  $$values (400::smallint,'RESCHEDULE_NO_CHANGE'::text)$$,
  'block rescheduling rejects a no-op'
);

select results_eq(
  $$select http_status,result->>'code' from gioia_private.owner_reschedule_appointment(
    '91000000-0000-4000-8000-000000000001','owner:appointment:move:conflict',
    decode(repeat('a5',32),'hex'),current_setting('gioia.test_appointment_id')::uuid,
    2,current_setting('gioia.test_date_c')::date,660::smallint,'manicure','manicure-30-min')$$,
  $$values (409::smallint,'SLOT_UNAVAILABLE'::text)$$,
  'appointment cannot move onto an active block'
);
select results_eq(
  $$select http_status,result->>'code' from gioia_private.owner_reschedule_block(
    '91000000-0000-4000-8000-000000000001','owner:block:move:conflict',
    decode(repeat('b5',32),'hex'),current_setting('gioia.test_block_id')::uuid,2,
    current_setting('gioia.test_date_b')::date,600::smallint,30::smallint,0::smallint)$$,
  $$values (409::smallint,'SLOT_UNAVAILABLE'::text)$$,
  'block cannot move onto a confirmed appointment'
);
select results_eq(
  $$select http_status,result->>'code' from gioia_private.owner_reschedule_appointment(
    '91000000-0000-4000-8000-000000000001','owner:appointment:move:vacation',
    decode(repeat('a6',32),'hex'),current_setting('gioia.test_appointment_id')::uuid,
    2,current_setting('gioia.test_date_d')::date,600::smallint,'manicure','manicure-30-min')$$,
  $$values (409::smallint,'DATE_CLOSED_FOR_VACATION'::text)$$,
  'appointment cannot move onto an active vacation'
);
select results_eq(
  $$select http_status,result->>'code' from gioia_private.owner_reschedule_block(
    '91000000-0000-4000-8000-000000000001','owner:block:move:closing',
    decode(repeat('b6',32),'hex'),current_setting('gioia.test_block_id')::uuid,2,
    current_setting('gioia.test_date_c')::date,1200::smallint,30::smallint,0::smallint)$$,
  $$values (409::smallint,'SLOT_OUTSIDE_BUSINESS_HOURS'::text)$$,
  'block cannot move beyond the closing boundary'
);

reset role;
select results_eq(
  $$select kind,local_date,start_minutes,version from gioia_private.schedule_entries
    order by kind$$,
  $$values
    ('appointment'::text,current_setting('gioia.test_date_b')::date,600::smallint,2),
    ('block'::text,current_setting('gioia.test_date_c')::date,660::smallint,2)$$,
  'all rejected moves preserve original rows and versions'
);

set local role app_runtime;
select results_eq(
  $$select http_status,result->>'code',replayed from gioia_private.owner_cancel_schedule_entry(
    '91000000-0000-4000-8000-000000000001','owner:appointment:cancel:1',
    decode(repeat('a7',32),'hex'),current_setting('gioia.test_appointment_id')::uuid,
    2,'Richiesta sintetica')$$,
  $$values (200::smallint,'SCHEDULE_ENTRY_CANCELLED'::text,false)$$,
  'owner soft-cancels a confirmed appointment'
);
select results_eq(
  $$select http_status,result->>'code',replayed from gioia_private.owner_cancel_schedule_entry(
    '91000000-0000-4000-8000-000000000001','owner:appointment:cancel:1',
    decode(repeat('a7',32),'hex'),current_setting('gioia.test_appointment_id')::uuid,
    2,'Richiesta sintetica')$$,
  $$values (200::smallint,'SCHEDULE_ENTRY_CANCELLED'::text,true)$$,
  'soft cancellation replays after the row version changes'
);

reset role;
select results_eq(
  $$select status,version,cancelled_by,cancellation_reason,cancelled_at is not null
    from gioia_private.schedule_entries
    where id=current_setting('gioia.test_appointment_id')::uuid$$,
  $$values ('cancelled'::text,3,'admin'::text,'Richiesta sintetica'::text,true)$$,
  'soft cancellation retains immutable evidence on the row'
);

set local role app_runtime;
select is((select count(*) from gioia_private.get_public_availability(
  current_setting('gioia.test_date_b')::date,'manicure','manicure-30-min')
  where start_minutes=600),1::bigint,'cancelled appointment releases its slot');
select is((select count(*) from gioia_private.get_public_availability(
  current_setting('gioia.test_date_c')::date,'manicure','manicure-30-min')
  where start_minutes=660),0::bigint,'active block continues suppressing availability');

reset role;
select results_eq(
  $$select aggregate_id,aggregate_version,change_kind from gioia_private.domain_change_log
    order by sequence_id$$,
  $$values
    (current_setting('gioia.test_appointment_id')::uuid,1,'create'::text),
    (current_setting('gioia.test_appointment_id')::uuid,2,'reschedule'::text),
    (current_setting('gioia.test_block_id')::uuid,1,'block'::text),
    (current_setting('gioia.test_block_id')::uuid,2,'reschedule'::text),
    (current_setting('gioia.test_appointment_id')::uuid,3,'cancel'::text)$$,
  'only successful mutations append versioned audit rows'
);
select results_eq(
  $$select aggregate_version,template_kind from gioia_private.email_outbox
    order by aggregate_version,template_kind$$,
  $$values (1,'booking_customer'::text),(1,'booking_owner'::text),
    (2,'reschedule_customer'::text),(2,'reschedule_owner'::text),
    (3,'cancellation_customer'::text),(3,'cancellation_owner'::text)$$,
  'appointment lifecycle enqueues exactly two emails per successful version'
);
select results_eq(
  $$select state,http_status,coalesce(error_code,''),count(*)
    from gioia_private.command_requests group by state,http_status,error_code
    order by state,http_status,error_code$$,
  $$values
    ('completed'::text,200::smallint,''::text,3::bigint),
    ('completed'::text,201::smallint,''::text,2::bigint),
    ('failed'::text,400::smallint,'RESCHEDULE_NO_CHANGE'::text,2::bigint),
    ('failed'::text,409::smallint,'DATE_CLOSED_FOR_VACATION'::text,1::bigint),
    ('failed'::text,409::smallint,'SLOT_OUTSIDE_BUSINESS_HOURS'::text,1::bigint),
    ('failed'::text,409::smallint,'SLOT_UNAVAILABLE'::text,2::bigint),
    ('failed'::text,409::smallint,'VERSION_CONFLICT'::text,2::bigint)$$,
  'command ledger records each deterministic outcome and no replay duplicates'
);
select ok(not exists (
  select 1 from gioia_private.command_requests where response_snapshot ?| array[
    'client_name','client_email','client_phone','client_note','reason']
) and not exists (
  select 1 from gioia_private.domain_change_log
  where to_jsonb(domain_change_log)::text like '%owner-client@commands.test%'
     or to_jsonb(domain_change_log)::text like '%Segreto-outbox%'
),'command responses and audit rows contain no customer values');
select ok((select count(*) from gioia_private.email_outbox)=6 and not exists (
  select 1 from gioia_private.email_outbox
  where template_data ?| array['client_email','client_phone','client_note','internal_note']
     or to_jsonb(email_outbox)::text like '%+39000000199%'
     or to_jsonb(email_outbox)::text like '%Segreto-outbox%'
     or (template_kind like 'reschedule_%' and not template_data @>
       jsonb_build_object('old_local_date',current_setting('gioia.test_date_a'),
         'old_start_minutes',600))
),'outbox snapshots retain old-slot delivery data without phone numbers or notes');

select * from finish();
rollback;

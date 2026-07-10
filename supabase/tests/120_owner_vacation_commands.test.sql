begin;

grant app_runtime to postgres;
grant usage on schema extensions to app_runtime;
set local search_path = extensions, public, pg_catalog;

select plan(19);

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
    order by day.value limit 2
  ) as candidate;
  perform set_config('gioia.test_occupied_date', v_dates[1]::text, true);
  perform set_config('gioia.test_vacation_date', v_dates[2]::text, true);
end
$setup$;

with test_user as (
  insert into auth.users (
    instance_id, id, aud, role, email, email_confirmed_at,
    raw_app_meta_data, raw_user_meta_data, created_at, updated_at
  ) values (
    '00000000-0000-0000-0000-000000000000',
    '92000000-0000-4000-8000-000000000001',
    'authenticated', 'authenticated', 'owner@vacation-command.test',
    statement_timestamp(), '{"provider":"email","providers":["email"]}'::jsonb,
    '{}'::jsonb, statement_timestamp(), statement_timestamp()
  ) returning id
)
insert into gioia_private.owner_accounts (user_id) select id from test_user;

insert into gioia_private.schedule_entries (
  id,kind,status,source,local_date,start_minutes,
  service_duration_minutes,buffer_minutes,internal_note,created_by
) values (
  '92000000-0000-4000-8000-000000000002','block','active','admin',
  current_setting('gioia.test_occupied_date')::date,600,30,0,
  'Occupazione sintetica','92000000-0000-4000-8000-000000000001'
);

set local role app_runtime;
select results_eq(
  $$select http_status,result->>'code',replayed from gioia_private.owner_create_vacation(
    '92000000-0000-4000-8000-000000000001','owner:vacation:occupied:1',
    decode(repeat('c1',32),'hex'),current_setting('gioia.test_occupied_date')::date,
    current_setting('gioia.test_occupied_date')::date,'Conflitto sintetico')$$,
  $$values (409::smallint,'VACATION_CONFLICTS_WITH_SCHEDULE'::text,false)$$,
  'vacation creation rejects an occupied inclusive span'
);

reset role;
select is((select count(*) from gioia_private.vacations),0::bigint,
  'occupied-span rejection creates no vacation row');

set local role app_runtime;
select results_eq(
  $$select http_status,result->>'code',replayed from gioia_private.owner_create_vacation(
    '92000000-0000-4000-8000-000000000001','owner:vacation:create:1',
    decode(repeat('c2',32),'hex'),current_setting('gioia.test_vacation_date')::date,
    current_setting('gioia.test_vacation_date')::date,' Chiusura sintetica ')$$,
  $$values (201::smallint,'VACATION_CREATED'::text,false)$$,
  'owner vacation creation succeeds'
);
select results_eq(
  $$select http_status,result->>'code',replayed from gioia_private.owner_create_vacation(
    '92000000-0000-4000-8000-000000000001','owner:vacation:create:1',
    decode(repeat('c2',32),'hex'),current_setting('gioia.test_vacation_date')::date,
    current_setting('gioia.test_vacation_date')::date,' Chiusura sintetica ')$$,
  $$values (201::smallint,'VACATION_CREATED'::text,true)$$,
  'vacation creation replays without another row'
);

reset role;
do $$begin perform set_config('gioia.test_vacation_id',(
  select resource_id::text from gioia_private.command_requests
  where idempotency_key='owner:vacation:create:1'),true); end$$;
select results_eq(
  $$select status,reason,source,created_by,version from gioia_private.vacations
    where id=current_setting('gioia.test_vacation_id')::uuid$$,
  $$values ('active'::text,'Chiusura sintetica'::text,'admin'::text,
    '92000000-0000-4000-8000-000000000001'::uuid,1)$$,
  'active vacation stores normalized reason and owner provenance'
);

set local role app_runtime;
select is((select count(*) from gioia_private.get_public_availability(
  current_setting('gioia.test_vacation_date')::date,'manicure','manicure-30-min')),
  0::bigint,'active vacation removes every public slot on its date');

select results_eq(
  $$select http_status,result->>'code' from gioia_private.owner_create_appointment(
    '92000000-0000-4000-8000-000000000001','owner:appointment:on-vacation',
    decode(repeat('c3',32),'hex'),current_setting('gioia.test_vacation_date')::date,
    600::smallint,'manicure','manicure-30-min','Cliente Chiuso',
    'closed@vacation-command.test',null,null)$$,
  $$values (409::smallint,'DATE_CLOSED_FOR_VACATION'::text)$$,
  'booking command and vacation creation share the date-lock boundary'
);

select results_eq(
  $$select http_status,result->>'code',replayed from gioia_private.owner_cancel_vacation(
    '92000000-0000-4000-8000-000000000001','owner:vacation:cancel:stale',
    decode(repeat('c4',32),'hex'),current_setting('gioia.test_vacation_id')::uuid,99)$$,
  $$values (409::smallint,'VERSION_CONFLICT'::text,false)$$,
  'vacation cancellation rejects a stale version'
);

reset role;
select results_eq(
  $$select status,version,cancelled_at is null,cancelled_by is null
    from gioia_private.vacations
    where id=current_setting('gioia.test_vacation_id')::uuid$$,
  $$values ('active'::text,1,true,true)$$,
  'stale cancellation preserves active state and evidence'
);

set local role app_runtime;
select results_eq(
  $$select http_status,result->>'code',replayed from gioia_private.owner_cancel_vacation(
    '92000000-0000-4000-8000-000000000001','owner:vacation:cancel:1',
    decode(repeat('c5',32),'hex'),current_setting('gioia.test_vacation_id')::uuid,1)$$,
  $$values (200::smallint,'VACATION_CANCELLED'::text,false)$$,
  'owner soft-cancels an active vacation'
);
select results_eq(
  $$select http_status,result->>'code',replayed from gioia_private.owner_cancel_vacation(
    '92000000-0000-4000-8000-000000000001','owner:vacation:cancel:1',
    decode(repeat('c5',32),'hex'),current_setting('gioia.test_vacation_id')::uuid,1)$$,
  $$values (200::smallint,'VACATION_CANCELLED'::text,true)$$,
  'vacation cancellation replays after version changes'
);

reset role;
select results_eq(
  $$select status,version,cancelled_at is not null,cancelled_by
    from gioia_private.vacations
    where id=current_setting('gioia.test_vacation_id')::uuid$$,
  $$values ('cancelled'::text,2,true,
    '92000000-0000-4000-8000-000000000001'::uuid)$$,
  'soft cancellation retains vacation and owner evidence'
);

set local role app_runtime;
select is((select count(*) from gioia_private.get_public_availability(
  current_setting('gioia.test_vacation_date')::date,'manicure','manicure-30-min')
  where start_minutes=600),1::bigint,
  'cancelling a vacation restores public availability');

reset role;
select throws_ok(format(
  'update gioia_private.vacations set reason = %L where id = %L',
  'Mutazione vietata',current_setting('gioia.test_vacation_id')),
  '23514','Cancelled vacations are immutable',
  'cancelled vacation dates and evidence remain immutable');

select results_eq(
  $$select aggregate_id,aggregate_version,change_kind
    from gioia_private.domain_change_log order by sequence_id$$,
  $$values
    (current_setting('gioia.test_vacation_id')::uuid,1,'create'::text),
    (current_setting('gioia.test_vacation_id')::uuid,2,'cancel'::text)$$,
  'only successful vacation mutations append audit rows'
);
select results_eq(
  $$select operation,state,http_status,coalesce(error_code,'')
    from gioia_private.command_requests order by operation,state,http_status,error_code$$,
  $$values
    ('owner_cancel_vacation'::text,'completed'::text,200::smallint,''::text),
    ('owner_cancel_vacation'::text,'failed'::text,409::smallint,'VERSION_CONFLICT'::text),
    ('owner_create_appointment'::text,'failed'::text,409::smallint,
      'DATE_CLOSED_FOR_VACATION'::text),
    ('owner_create_vacation'::text,'completed'::text,201::smallint,''::text),
    ('owner_create_vacation'::text,'failed'::text,409::smallint,
      'VACATION_CONFLICTS_WITH_SCHEDULE'::text)$$,
  'vacation command outcomes and booking rejection are deterministic'
);
select ok(not exists (
  select 1 from gioia_private.command_requests
  where response_snapshot ?| array['reason','actor_user_id','client_name','client_email']
) and not exists (
  select 1 from gioia_private.domain_change_log
  where to_jsonb(domain_change_log)::text like '%Chiusura sintetica%'
     or to_jsonb(domain_change_log)::text like '%Conflitto sintetico%'
),'vacation responses and audit rows exclude reason and customer values');
select is((select count(*) from gioia_private.email_outbox),0::bigint,
  'vacation operations and rejected booking enqueue no email');
select is((select count(*) from gioia_private.vacations),1::bigint,
  'replays and conflicts leave one soft-cancelled vacation row');

select * from finish();
rollback;

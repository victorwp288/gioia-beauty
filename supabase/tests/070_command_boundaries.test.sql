begin;

grant app_runtime to postgres;
grant usage on schema extensions to app_runtime;

set local search_path = extensions, public, pg_catalog;

select plan(17);

do $setup$
declare
  v_date date;
begin
  select min(candidate.local_date)::date
  into strict v_date
  from generate_series(
    ((statement_timestamp() at time zone 'Europe/Rome')::date + 1)::timestamp,
    ((statement_timestamp() at time zone 'Europe/Rome')::date + 7)::timestamp,
    interval '1 day'
  ) as candidate(local_date)
  where extract(isodow from candidate.local_date) between 1 and 5;

  perform set_config('gioia.test_local_date', v_date::text, true);
end
$setup$;

select lives_ok(
  $sql$
    with test_user as (
      insert into auth.users (
        instance_id, id, aud, role, email, email_confirmed_at,
        raw_app_meta_data, raw_user_meta_data, created_at, updated_at
      ) values (
        '00000000-0000-0000-0000-000000000000',
        '90000000-0000-4000-8000-000000000001',
        'authenticated', 'authenticated', 'owner@commands.test', statement_timestamp(),
        '{"provider":"email","providers":["email"]}'::jsonb,
        '{}'::jsonb, statement_timestamp(), statement_timestamp()
      ) returning id
    )
    insert into gioia_private.owner_accounts (user_id)
    select id from test_user
  $sql$,
  'command tests use a deterministic synthetic owner'
);

insert into gioia_private.owner_sessions (session_id,user_id,expires_at)
values ('90500000-0000-4000-8000-000000000001','90000000-0000-4000-8000-000000000001',statement_timestamp()+interval '1 hour');

do $owner_claim$
begin
  perform set_config(
    'request.jwt.claim.sub',
    '90000000-0000-4000-8000-000000000001',
    true
  );
  perform set_config('request.jwt.claim.session_id','90500000-0000-4000-8000-000000000001',true);
end
$owner_claim$;

insert into gioia_private.command_requests (
  operation, principal_scope_hash, idempotency_key,
  request_fingerprint, state, expires_at
) values (
  'public_booking', decode(repeat('41', 32), 'hex'),
  'public:test:in-progress', decode(repeat('42', 32), 'hex'),
  'in_progress', statement_timestamp() + interval '10 minutes'
);

set local role app_runtime;

select throws_ok(
  $sql$
    select * from gioia_private.create_public_booking(
      decode(repeat('41', 32), 'hex'), 'public:test:in-progress',
      decode(repeat('42', 32), 'hex'),
      current_setting('gioia.test_local_date')::date, 600::smallint,
      'manicure', 'manicure-30-min', 'Cliente In Corso',
      'in-progress@commands.test', '+39000000002', null
    )
  $sql$,
  'PT409', 'COMMAND_IN_PROGRESS',
  'a duplicate in-flight command fails closed without another mutation'
);

select results_eq(
  $actual$
    select command.http_status, command.result ->> 'code', command.replayed
    from gioia_private.create_public_booking(
      decode(repeat('11', 32), 'hex'), 'public:test:0001',
      decode(repeat('21', 32), 'hex'),
      current_setting('gioia.test_local_date')::date, 600::smallint,
      'manicure', 'manicure-30-min', 'Cliente Test',
      'client@commands.test', '+39000000000', null
    ) as command
  $actual$,
  $expected$
    values (201::smallint, 'BOOKING_CREATED'::text, false)
  $expected$,
  'app_runtime can create one valid public booking through the command boundary'
);

select results_eq(
  $actual$
    select command.http_status, command.result ->> 'code', command.replayed
    from gioia_private.create_public_booking(
      decode(repeat('11', 32), 'hex'), 'public:test:0001',
      decode(repeat('21', 32), 'hex'),
      current_setting('gioia.test_local_date')::date, 600::smallint,
      'manicure', 'manicure-30-min', 'Cliente Test',
      'client@commands.test', '+39000000000', null
    ) as command
  $actual$,
  $expected$
    values (201::smallint, 'BOOKING_CREATED'::text, true)
  $expected$,
  'an identical idempotent public booking replays its redacted result'
);

select throws_ok(
  $sql$
    select * from gioia_private.create_public_booking(
      decode(repeat('11', 32), 'hex'), 'public:test:0001',
      decode(repeat('22', 32), 'hex'),
      current_setting('gioia.test_local_date')::date, 600::smallint,
      'manicure', 'manicure-30-min', 'Cliente Test',
      'client@commands.test', '+39000000000', null
    )
  $sql$,
  'PT409', 'IDEMPOTENCY_KEY_REUSED',
  'reusing an idempotency key with another fingerprint fails closed'
);

select results_eq(
  $actual$
    select command.http_status, command.result ->> 'code', command.replayed
    from gioia_private.create_public_booking(
      decode(repeat('12', 32), 'hex'), 'public:test:0002',
      decode(repeat('23', 32), 'hex'),
      current_setting('gioia.test_local_date')::date, 600::smallint,
      'manicure', 'manicure-30-min', 'Cliente Due',
      'second@commands.test', '+39000000001', null
    ) as command
  $actual$,
  $expected$
    values (409::smallint, 'SLOT_UNAVAILABLE'::text, false)
  $expected$,
  'a second command cannot occupy the same slot'
);

select is(
  (
    select count(*)
    from gioia_private.get_public_availability(
      current_setting('gioia.test_local_date')::date,
      'manicure', 'manicure-30-min'
    ) as availability
    where availability.start_minutes = 600
  ),
  0::bigint,
  'public availability excludes the newly occupied slot'
);

select ok(
  (
    select count(*) <= 96
      and count(*) filter (where availability.start_minutes % 15 <> 0) = 0
    from gioia_private.get_public_availability(
      current_setting('gioia.test_local_date')::date,
      'manicure', 'manicure-30-min'
    ) as availability
  ),
  'public availability stays bounded and exactly 15-minute aligned'
);

select throws_ok(
  $sql$
    select * from gioia_private.owner_create_block(
      '90000000-0000-4000-8000-000000000099', 'block:test:denied',
      decode(repeat('31', 32), 'hex'),
      current_setting('gioia.test_local_date')::date,
      660::smallint, 30::smallint, 0::smallint, 'Denied'
    )
  $sql$,
  'PT403', 'OWNER_IDENTITY_MISMATCH',
  'owner commands reject an actor that differs from the authenticated identity'
);

select results_eq(
  $actual$
    select command.http_status, command.result ->> 'code', command.replayed
    from gioia_private.owner_create_block(
      '90000000-0000-4000-8000-000000000001', 'block:test:0001',
      decode(repeat('32', 32), 'hex'),
      current_setting('gioia.test_local_date')::date,
      660::smallint, 30::smallint, 0::smallint,
      'Blocco sintetico'
    ) as command
  $actual$,
  $expected$
    values (201::smallint, 'BLOCK_CREATED'::text, false)
  $expected$,
  'an enabled owner can create a bounded non-overlapping block'
);

select results_eq(
  $actual$
    select command.http_status, command.result ->> 'code', command.replayed
    from gioia_private.owner_create_block(
      '90000000-0000-4000-8000-000000000001', 'block:test:0001',
      decode(repeat('32', 32), 'hex'),
      current_setting('gioia.test_local_date')::date,
      660::smallint, 30::smallint, 0::smallint,
      'Blocco sintetico'
    ) as command
  $actual$,
  $expected$
    values (201::smallint, 'BLOCK_CREATED'::text, true)
  $expected$,
  'an identical owner command replays without another write'
);

reset role;

delete from gioia_private.command_requests
where idempotency_key = 'public:test:in-progress';

select is(
  (select count(*) from gioia_private.schedule_entries),
  2::bigint,
  'command flow creates exactly one appointment and one block'
);

select is(
  (select count(*) from gioia_private.email_outbox),
  2::bigint,
  'one public booking enqueues exactly owner and customer email snapshots'
);

select is(
  (select count(*) from gioia_private.domain_change_log),
  2::bigint,
  'successful booking and block commands append exactly two audit rows'
);

select is(
  (select count(*) from gioia_private.command_requests),
  3::bigint,
  'success, conflict, and owner mutation create three command records'
);

select is(
  (
    select count(*)
    from gioia_private.command_requests
    where state = 'failed'
      and http_status = 409
      and response_snapshot = '{"code":"SLOT_UNAVAILABLE"}'::jsonb
  ),
  1::bigint,
  'failed overlap command stores one redacted deterministic response'
);

select ok(
  not exists (
    select 1
    from gioia_private.domain_change_log as audit
    where to_jsonb(audit)::text like '%@commands.test%'
      or to_jsonb(audit)::text like '%Cliente Test%'
  ),
  'audit rows contain no customer values'
);

select * from finish();

rollback;

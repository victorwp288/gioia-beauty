begin;

grant app_runtime to postgres;
grant usage on schema extensions to app_runtime;

set local search_path = extensions, public, pg_catalog;

select plan(14);

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
    insert into gioia_private.command_requests (
      id, operation, principal_scope_hash, idempotency_key,
      request_fingerprint, state, resource_kind, resource_id,
      http_status, error_code, response_snapshot,
      created_at, expires_at, completed_at
    ) values
      (
        '65000000-0000-4000-8000-000000000001', 'public_booking',
        decode(repeat('31', 32), 'hex'), 'stale:completed:0001',
        decode(repeat('51', 32), 'hex'), 'completed',
        'schedule_entry', '65000000-0000-4000-8000-000000000011',
        201, null,
        '{"code":"BOOKING_CREATED",
          "resource_id":"65000000-0000-4000-8000-000000000011"}'::jsonb,
        statement_timestamp() - interval '2 days',
        statement_timestamp() - interval '1 day',
        statement_timestamp() - interval '12 hours'
      ),
      (
        '65000000-0000-4000-8000-000000000002', 'public_booking',
        decode(repeat('31', 32), 'hex'), 'stale:failed:0001',
        decode(repeat('52', 32), 'hex'), 'failed', null, null,
        409, 'SLOT_UNAVAILABLE', '{"code":"SLOT_UNAVAILABLE"}'::jsonb,
        statement_timestamp() - interval '2 days',
        statement_timestamp() - interval '1 day',
        statement_timestamp() - interval '12 hours'
      ),
      (
        '65000000-0000-4000-8000-000000000003', 'public_booking',
        decode(repeat('31', 32), 'hex'), 'active:inprogress:0001',
        decode(repeat('53', 32), 'hex'), 'in_progress', null, null,
        null, null, null, statement_timestamp(),
        statement_timestamp() + interval '1 day', null
      ),
      (
        '65000000-0000-4000-8000-000000000004', 'public_booking',
        decode(repeat('31', 32), 'hex'), 'stale:inprogress:0001',
        decode(repeat('54', 32), 'hex'), 'in_progress', null, null,
        null, null, null, statement_timestamp() - interval '2 days',
        statement_timestamp() - interval '1 day', null
      )
  $sql$,
  'terminal, active, and expired command fixtures are accepted'
);

set local role app_runtime;

select results_eq(
  $actual$
    select command.http_status, command.result ->> 'code', command.replayed
    from gioia_private.create_public_booking(
      decode(repeat('31', 32), 'hex'), 'stale:completed:0001',
      decode(repeat('51', 32), 'hex'),
      current_setting('gioia.test_local_date')::date, 600::smallint,
      'manicure', 'manicure-30-min', 'Cliente Scaduto',
      'stale-completed@commands.test', '+39000000031', null
    ) as command
  $actual$,
  $expected$
    values (201::smallint, 'BOOKING_CREATED'::text, true)
  $expected$,
  'an expired completed command replays the stored outcome'
);

select throws_ok(
  $sql$
    select * from gioia_private.create_public_booking(
      decode(repeat('31', 32), 'hex'), 'stale:completed:0001',
      decode(repeat('61', 32), 'hex'),
      current_setting('gioia.test_local_date')::date, 600::smallint,
      'manicure', 'manicure-30-min', 'Cliente Scaduto',
      'stale-completed@commands.test', '+39000000031', null
    )
  $sql$,
  'PT409', 'IDEMPOTENCY_KEY_REUSED',
  'an expired completed key rejects a changed fingerprint'
);

select results_eq(
  $actual$
    select command.http_status, command.result ->> 'code', command.replayed
    from gioia_private.create_public_booking(
      decode(repeat('31', 32), 'hex'), 'stale:failed:0001',
      decode(repeat('52', 32), 'hex'),
      current_setting('gioia.test_local_date')::date, 615::smallint,
      'manicure', 'manicure-30-min', 'Cliente Fallito',
      'stale-failed@commands.test', '+39000000032', null
    ) as command
  $actual$,
  $expected$
    values (409::smallint, 'SLOT_UNAVAILABLE'::text, true)
  $expected$,
  'an expired failed command replays the stored outcome'
);

select throws_ok(
  $sql$
    select * from gioia_private.create_public_booking(
      decode(repeat('31', 32), 'hex'), 'stale:failed:0001',
      decode(repeat('62', 32), 'hex'),
      current_setting('gioia.test_local_date')::date, 615::smallint,
      'manicure', 'manicure-30-min', 'Cliente Fallito',
      'stale-failed@commands.test', '+39000000032', null
    )
  $sql$,
  'PT409', 'IDEMPOTENCY_KEY_REUSED',
  'an expired failed key rejects a changed fingerprint'
);

select throws_ok(
  $sql$
    select * from gioia_private.create_public_booking(
      decode(repeat('31', 32), 'hex'), 'active:inprogress:0001',
      decode(repeat('53', 32), 'hex'),
      current_setting('gioia.test_local_date')::date, 630::smallint,
      'manicure', 'manicure-30-min', 'Cliente Attivo',
      'active@commands.test', '+39000000033', null
    )
  $sql$,
  'PT409', 'COMMAND_IN_PROGRESS',
  'an active in-progress duplicate fails closed'
);

select throws_ok(
  $sql$
    select * from gioia_private.create_public_booking(
      decode(repeat('31', 32), 'hex'), 'active:inprogress:0001',
      decode(repeat('63', 32), 'hex'),
      current_setting('gioia.test_local_date')::date, 630::smallint,
      'manicure', 'manicure-30-min', 'Cliente Attivo',
      'active@commands.test', '+39000000033', null
    )
  $sql$,
  'PT409', 'IDEMPOTENCY_KEY_REUSED',
  'an active in-progress key rejects a changed fingerprint'
);

select throws_ok(
  $sql$
    select * from gioia_private.create_public_booking(
      decode(repeat('31', 32), 'hex'), 'stale:inprogress:0001',
      decode(repeat('54', 32), 'hex'),
      current_setting('gioia.test_local_date')::date, 645::smallint,
      'manicure', 'manicure-30-min', 'Cliente Bloccato',
      'stale-inprogress@commands.test', '+39000000034', null
    )
  $sql$,
  'PT409', 'COMMAND_IN_PROGRESS',
  'an expired in-progress duplicate remains fail-closed'
);

select throws_ok(
  $sql$
    select * from gioia_private.create_public_booking(
      decode(repeat('31', 32), 'hex'), 'stale:inprogress:0001',
      decode(repeat('64', 32), 'hex'),
      current_setting('gioia.test_local_date')::date, 645::smallint,
      'manicure', 'manicure-30-min', 'Cliente Bloccato',
      'stale-inprogress@commands.test', '+39000000034', null
    )
  $sql$,
  'PT409', 'IDEMPOTENCY_KEY_REUSED',
  'an expired in-progress key rejects a changed fingerprint'
);

reset role;

select is(
  (select count(*) from gioia_private.command_requests),
  4::bigint,
  'stale probes create no additional command records'
);

select is(
  (select count(*) from gioia_private.schedule_entries),
  0::bigint,
  'stale probes create no schedule mutation'
);

select is(
  (select count(*) from gioia_private.email_outbox),
  0::bigint,
  'stale probes enqueue no email snapshots'
);

select is(
  (select count(*) from gioia_private.domain_change_log),
  0::bigint,
  'stale probes append no audit mutation'
);

select is(
  (
    select count(*)
    from gioia_private.command_requests
    where id between
      '65000000-0000-4000-8000-000000000001'::uuid
      and '65000000-0000-4000-8000-000000000004'::uuid
      and request_fingerprint in (
        decode(repeat('51', 32), 'hex'), decode(repeat('52', 32), 'hex'),
        decode(repeat('53', 32), 'hex'), decode(repeat('54', 32), 'hex')
      )
  ),
  4::bigint,
  'stale probes preserve every original command fingerprint'
);

select * from finish();

rollback;

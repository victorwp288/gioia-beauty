begin; grant app_runtime to postgres;
grant usage on schema extensions to app_runtime;
set local search_path = extensions, public, pg_catalog;

select plan(17);

select ok(
  pg_get_functiondef(
    'gioia_private.claim_email_outbox(text,smallint,smallint)'::regprocedure
  ) ~* 'for update skip locked'
    and pg_get_functiondef(
      'gioia_private.claim_email_outbox(text,smallint,smallint)'::regprocedure
    ) ~* 'limit p_batch_size',
  'claim uses a bounded SKIP LOCKED candidate set'
);

do $setup$
begin
  insert into gioia_private.schedule_entries (
    id, kind, status, source, local_date, start_minutes,
    service_duration_minutes, buffer_minutes, service_id, variant_id,
    service_name_snapshot, variant_name_snapshot, client_name, client_email
  ) values (
    '91000000-0000-4000-8000-000000000001',
    'appointment', 'confirmed', 'public', '2035-09-10', 600,
    30, 5, 'manicure', 'manicure-30-min', 'Manicure', 'Manicure',
    'Cliente Worker', 'worker-client@example.test'
  );

  insert into gioia_private.email_outbox (
    aggregate_kind, aggregate_id, aggregate_version, recipient_kind,
    recipient_address, template_kind, template_data, idempotency_key
  )
  select
    'schedule_entry', '91000000-0000-4000-8000-000000000001', 1, 'customer',
    'worker-client@example.test', 'booking_customer',
    '{"client_name":"Cliente Worker","local_date":"2035-09-10",
      "start_minutes":600,"service_duration_minutes":30,
      "service_name":"Manicure","variant_name":"Manicure"}'::jsonb,
    'worker:batch:' || batch_number::text
  from generate_series(1, 26) as batch(batch_number);
end
$setup$;

set local role app_runtime;

select throws_ok(
  $$select * from gioia_private.claim_email_outbox(
    'worker:invalid', 26::smallint, 120::smallint
  )$$,
  'PT400', 'OUTBOX_BATCH_INVALID',
  'claim rejects batches larger than 25'
);

select results_eq(
  $$select count(*) from gioia_private.claim_email_outbox(
    'worker:batch', 25::smallint, 120::smallint
  )$$,
  $$values (25::bigint)$$,
  'one claim returns at most 25 messages'
);

reset role;

select results_eq(
  $$select status, count(*) from gioia_private.email_outbox
    group by status order by status$$,
  $$values ('pending'::text, 1::bigint), ('sending'::text, 25::bigint)$$,
  'claim mutates exactly the bounded batch'
);

select ok(
  not exists (
    select 1 from gioia_private.email_outbox
    where status = 'sending'
      and (attempt_count <> 1 or locked_by <> 'worker:batch'
        or lease_expires_at <= locked_at or version <> 2)
  ),
  'claimed rows have monotonic attempts, versions, and bounded leases'
);

do $capture$
begin
  perform set_config(
    'gioia.test_success_outbox',
    (select id::text from gioia_private.email_outbox
      where status = 'sending' order by id limit 1), true
  );
end
$capture$;

set local role app_runtime;

select throws_ok(
  $$select * from gioia_private.complete_email_outbox_success(
    current_setting('gioia.test_success_outbox')::uuid,
    2, 'worker:stale', 'msg_worker_stale'
  )$$,
  'PT409', 'OUTBOX_CLAIM_STALE',
  'a different worker cannot complete another lease'
);

select results_eq(
  $$select delivery_status, attempt_count, current_version
    from gioia_private.complete_email_outbox_success(
      current_setting('gioia.test_success_outbox')::uuid,
      2, 'worker:batch', 'msg_worker_success'
    )$$,
  $$values ('sent'::text, 1::smallint, 3)$$,
  'the owning worker can persist provider success once'
);

reset role;

select results_eq(
  $$select status, provider_message_id, locked_by is null
    from gioia_private.email_outbox
    where id = current_setting('gioia.test_success_outbox')::uuid$$,
  $$values ('sent'::text, 'msg_worker_success'::text, true)$$,
  'success clears lease state and preserves provider identity'
);

do $failure_setup$
begin
  insert into gioia_private.email_outbox (
    id, aggregate_kind, aggregate_id, aggregate_version, recipient_kind,
    recipient_address, template_kind, template_data, idempotency_key,
    status, attempt_count, locked_at, locked_by, lease_expires_at
  ) values
  (
    '92000000-0000-4000-8000-000000000001', 'schedule_entry',
    '91000000-0000-4000-8000-000000000001', 1, 'customer',
    'worker-client@example.test', 'booking_customer',
    '{"client_name":"Cliente Worker","local_date":"2035-09-10",
      "start_minutes":600,"service_duration_minutes":30,
      "service_name":"Manicure","variant_name":"Manicure"}'::jsonb,
    'worker:failure:0001', 'sending', 1,
    statement_timestamp(), 'worker:failure', statement_timestamp() + interval '2 minutes'
  ),
  (
    '92000000-0000-4000-8000-000000000002', 'schedule_entry',
    '91000000-0000-4000-8000-000000000001', 1, 'customer',
    'worker-client@example.test', 'booking_customer',
    '{"client_name":"Cliente Worker","local_date":"2035-09-10",
      "start_minutes":600,"service_duration_minutes":30,
      "service_name":"Manicure","variant_name":"Manicure"}'::jsonb,
    'worker:failure:0002', 'sending', 5,
    statement_timestamp(), 'worker:ceiling', statement_timestamp() + interval '2 minutes'
  );
end
$failure_setup$;

set local role app_runtime;

select results_eq(
  $$select delivery_status, attempt_count, current_version
    from gioia_private.complete_email_outbox_failure(
      '92000000-0000-4000-8000-000000000001', 1,
      'worker:failure', 'PROVIDER_TEMPORARY', true
    )$$,
  $$values ('failed'::text, 1::smallint, 2)$$,
  'retryable failure schedules a later attempt'
);

reset role;

select ok(
  exists (
    select 1 from gioia_private.email_outbox
    where id = '92000000-0000-4000-8000-000000000001'
      and status = 'failed' and next_attempt_at > statement_timestamp()
      and locked_by is null and last_error_code = 'PROVIDER_TEMPORARY'
  ),
  'retry backoff is future-bounded and clears the lease'
);
do $$begin perform set_config('request.jwt.claim.session_id','99999999-0000-4000-8000-000000000098',true); end$$;
set local role app_runtime;
select results_eq(
  $$select delivery_status, attempt_count
    from gioia_private.complete_email_outbox_failure(
      '92000000-0000-4000-8000-000000000002', 1,
      'worker:ceiling', 'PROVIDER_TEMPORARY', true
    )$$,
  $$values ('dead_letter'::text, 5::smallint)$$,
  'attempt five is dead-lettered even for a retryable failure'
);

select throws_ok(
  $$select * from gioia_private.retry_email_outbox_as_owner(
    set_config('request.jwt.claim.sub', '99999999-0000-4000-8000-000000000099', true)::uuid, 'retry:test:denied',
    decode(repeat('51', 32), 'hex'),
    '92000000-0000-4000-8000-000000000002', 2
  )$$,
  'PT403', 'OWNER_AUTHORIZATION_REQUIRED',
  'outbox retry rejects an unknown owner'
);
reset role;
do $owner$
begin
  with test_user as (
    insert into auth.users (
      instance_id, id, aud, role, email, email_confirmed_at,
      raw_app_meta_data, raw_user_meta_data, created_at, updated_at
    ) values (
      '00000000-0000-0000-0000-000000000000',
      '93000000-0000-4000-8000-000000000001',
      'authenticated', 'authenticated', 'owner@worker.test', statement_timestamp(),
      '{"provider":"email","providers":["email"]}'::jsonb,
      '{}'::jsonb, statement_timestamp(), statement_timestamp()
    ) returning id
  )
  insert into gioia_private.owner_accounts (user_id) select id from test_user;
end
$owner$;
insert into gioia_private.owner_sessions (session_id,user_id,expires_at) values ('93500000-0000-4000-8000-000000000001','93000000-0000-4000-8000-000000000001',statement_timestamp()+interval '1 hour');
do $$begin perform set_config('request.jwt.claim.session_id','93500000-0000-4000-8000-000000000001',true); end$$;
set local role app_runtime;
select results_eq(
  $$select http_status, result ->> 'code', replayed
    from gioia_private.retry_email_outbox_as_owner(
      set_config('request.jwt.claim.sub', '93000000-0000-4000-8000-000000000001', true)::uuid, 'retry:test:0001',
      decode(repeat('52', 32), 'hex'),
      '92000000-0000-4000-8000-000000000002', 2
    )$$,
  $$values (200::smallint, 'OUTBOX_RETRY_SCHEDULED'::text, false)$$,
  'an enabled owner can requeue a dead letter optimistically'
);
select results_eq(
  $$select http_status, replayed
    from gioia_private.retry_email_outbox_as_owner(
      '93000000-0000-4000-8000-000000000001', 'retry:test:0001',
      decode(repeat('52', 32), 'hex'),
      '92000000-0000-4000-8000-000000000002', 2
    )$$,
  $$values (200::smallint, true)$$,
  'owner retry is idempotent'
);
reset role;

select results_eq(
  $$select status, attempt_count, version
    from gioia_private.email_outbox
    where id = '92000000-0000-4000-8000-000000000002'$$,
  $$values ('failed'::text, 5::smallint, 3)$$,
  'owner retry preserves monotonic attempts and advances version'
);

do $leases$
begin
  insert into gioia_private.email_outbox (
    id, aggregate_kind, aggregate_id, aggregate_version, recipient_kind,
    recipient_address, template_kind, template_data, idempotency_key,
    status, attempt_count, locked_at, locked_by, lease_expires_at
  ) values
  (
    '94000000-0000-4000-8000-000000000001', 'schedule_entry',
    '91000000-0000-4000-8000-000000000001', 1, 'customer',
    'worker-client@example.test', 'booking_customer',
    '{"client_name":"Cliente Worker","local_date":"2035-09-10",
      "start_minutes":600,"service_duration_minutes":30,
      "service_name":"Manicure","variant_name":"Manicure"}'::jsonb,
    'worker:lease:0001', 'sending', 2,
    statement_timestamp() - interval '2 minutes', 'worker:old',
    statement_timestamp() - interval '1 minute'
  ),
  (
    '94000000-0000-4000-8000-000000000002', 'schedule_entry',
    '91000000-0000-4000-8000-000000000001', 1, 'customer',
    'worker-client@example.test', 'booking_customer',
    '{"client_name":"Cliente Worker","local_date":"2035-09-10",
      "start_minutes":600,"service_duration_minutes":30,
      "service_name":"Manicure","variant_name":"Manicure"}'::jsonb,
    'worker:lease:0002', 'sending', 5,
    statement_timestamp() - interval '2 minutes', 'worker:old',
    statement_timestamp() - interval '1 minute'
  );
end
$leases$;

set local role app_runtime;
select results_eq(
  $$select attempt_count, expected_version
    from gioia_private.claim_email_outbox(
      'worker:recovery', 25::smallint, 120::smallint
    ) where outbox_id = '94000000-0000-4000-8000-000000000001'$$,
  $$values (3::smallint, 2)$$,
  'an expired lease is safely reclaimed with a new attempt and version'
);
reset role;

select results_eq(
  $$select status, attempt_count, last_error_code
    from gioia_private.email_outbox
    where id = '94000000-0000-4000-8000-000000000002'$$,
  $$values ('dead_letter'::text, 5::smallint, 'LEASE_EXPIRED'::text)$$,
  'an expired ceiling attempt is dead-lettered instead of reclaimed'
);

select * from finish();
rollback;

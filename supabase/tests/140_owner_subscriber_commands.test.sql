begin;

grant app_runtime to postgres;
grant usage on schema extensions to app_runtime;
set local search_path = extensions, public, pg_catalog;

select plan(16);

select has_function(
  'gioia_private', 'owner_unsubscribe_subscriber',
  array['uuid', 'text', 'bytea', 'uuid', 'integer'],
  'the owner subscriber mutation boundary exists'
);
select ok(
  has_function_privilege(
    'app_runtime',
    'gioia_private.owner_unsubscribe_subscriber(uuid,text,bytea,uuid,integer)',
    'EXECUTE'
  )
  and not has_function_privilege(
    'anon',
    'gioia_private.owner_unsubscribe_subscriber(uuid,text,bytea,uuid,integer)',
    'EXECUTE'
  )
  and not has_function_privilege(
    'authenticated',
    'gioia_private.owner_unsubscribe_subscriber(uuid,text,bytea,uuid,integer)',
    'EXECUTE'
  )
  and not has_function_privilege(
    'service_role',
    'gioia_private.owner_unsubscribe_subscriber(uuid,text,bytea,uuid,integer)',
    'EXECUTE'
  ),
  'only app_runtime can execute the owner subscriber mutation boundary'
);

with test_user as (
  insert into auth.users (
    instance_id, id, aud, role, email, email_confirmed_at,
    raw_app_meta_data, raw_user_meta_data, created_at, updated_at
  ) values (
    '00000000-0000-0000-0000-000000000000',
    '94000000-0000-4000-8000-000000000001',
    'authenticated', 'authenticated', 'owner@subscriber-command.test',
    statement_timestamp(), '{"provider":"email","providers":["email"]}'::jsonb,
    '{}'::jsonb, statement_timestamp(), statement_timestamp()
  ) returning id
)
insert into gioia_private.owner_accounts (user_id) select id from test_user;
insert into gioia_private.owner_sessions (session_id, user_id, expires_at)
values (
  '94500000-0000-4000-8000-000000000001',
  '94000000-0000-4000-8000-000000000001',
  statement_timestamp() + interval '1 hour'
);
select set_config(
  'request.jwt.claim.sub', '94000000-0000-4000-8000-000000000001', true
);
select set_config(
  'request.jwt.claim.session_id',
  '94500000-0000-4000-8000-000000000001', true
);

insert into gioia_private.newsletter_subscribers (
  id, email, status, source, consent_at, consent_source,
  consent_policy_version, confirmed_at
) values
  (
    '95000000-0000-4000-8000-000000000001',
    'active-synthetic@subscriber-command.test', 'active', 'admin',
    statement_timestamp() - interval '2 days', 'admin_import',
    'newsletter-consent-v1', statement_timestamp() - interval '1 day'
  ),
  (
    '95000000-0000-4000-8000-000000000002',
    'complained-synthetic@subscriber-command.test', 'complained', 'admin',
    statement_timestamp() - interval '2 days', 'admin_import',
    'newsletter-consent-v1', null
  );

set local role app_runtime;

select results_eq(
  $$select http_status, result ->> 'code', replayed
    from gioia_private.owner_unsubscribe_subscriber(
      '94000000-0000-4000-8000-000000000001',
      'owner:subscriber:missing:1', decode(repeat('a1', 32), 'hex'),
      '95000000-0000-4000-8000-000000000099', 1
    )$$,
  $$values (404::smallint, 'SUBSCRIBER_NOT_FOUND'::text, false)$$,
  'unknown subscriber IDs return a stored not-found result'
);
select results_eq(
  $$select http_status, result ->> 'code', replayed
    from gioia_private.owner_unsubscribe_subscriber(
      '94000000-0000-4000-8000-000000000001',
      'owner:subscriber:stale:1', decode(repeat('a2', 32), 'hex'),
      '95000000-0000-4000-8000-000000000001', 9
    )$$,
  $$values (409::smallint, 'VERSION_CONFLICT'::text, false)$$,
  'stale subscriber versions are rejected'
);
select results_eq(
  $$select http_status, result ->> 'code', replayed
    from gioia_private.owner_unsubscribe_subscriber(
      '94000000-0000-4000-8000-000000000001',
      'owner:subscriber:complained:1', decode(repeat('a3', 32), 'hex'),
      '95000000-0000-4000-8000-000000000002', 1
    )$$,
  $$values (409::smallint, 'SUBSCRIBER_NOT_UNSUBSCRIBABLE'::text, false)$$,
  'complaint evidence cannot be rewritten as an unsubscribe'
);
select results_eq(
  $$select http_status, result ->> 'code', replayed
    from gioia_private.owner_unsubscribe_subscriber(
      '94000000-0000-4000-8000-000000000001',
      'owner:subscriber:unsubscribe:1', decode(repeat('a4', 32), 'hex'),
      '95000000-0000-4000-8000-000000000001', 1
    )$$,
  $$values (200::smallint, 'SUBSCRIBER_UNSUBSCRIBED'::text, false)$$,
  'an owner can soft-unsubscribe a marketable subscriber'
);
select results_eq(
  $$select http_status, result ->> 'code', replayed
    from gioia_private.owner_unsubscribe_subscriber(
      '94000000-0000-4000-8000-000000000001',
      'owner:subscriber:unsubscribe:1', decode(repeat('a4', 32), 'hex'),
      '95000000-0000-4000-8000-000000000001', 1
    )$$,
  $$values (200::smallint, 'SUBSCRIBER_UNSUBSCRIBED'::text, true)$$,
  'an identical owner unsubscribe replays after the version advances'
);
select throws_ok(
  $$select * from gioia_private.owner_unsubscribe_subscriber(
    '94000000-0000-4000-8000-000000000001',
    'owner:subscriber:unsubscribe:1', decode(repeat('ff', 32), 'hex'),
    '95000000-0000-4000-8000-000000000001', 1
  )$$,
  'PT409', 'IDEMPOTENCY_KEY_REUSED',
  'an idempotency key cannot be rebound to another fingerprint'
);

reset role;

select results_eq(
  $$select status, version, unsubscribed_at is not null
    from gioia_private.newsletter_subscribers
    where id = '95000000-0000-4000-8000-000000000001'$$,
  $$values ('unsubscribed'::text, 2, true)$$,
  'the subscriber row is retained with a versioned unsubscribe timestamp'
);
select is(
  (select count(*) from gioia_private.newsletter_subscribers), 2::bigint,
  'soft-unsubscribe and rejected commands never delete subscriber rows'
);
select results_eq(
  $$select aggregate_id, aggregate_version, change_kind, source, actor_user_id,
      changed_fields
    from gioia_private.domain_change_log$$,
  $$values (
    '95000000-0000-4000-8000-000000000001'::uuid, 2,
    'unsubscribe'::text, 'admin'::text,
    '94000000-0000-4000-8000-000000000001'::uuid,
    array['status', 'unsubscribed_at']::text[]
  )$$,
  'the successful mutation appends one actor-bound PII-free domain change'
);
select is(
  (select count(*) from gioia_private.newsletter_consent_events), 0::bigint,
  'an owner action does not fabricate token-bound public consent evidence'
);
select results_eq(
  $$select state, http_status, coalesce(error_code, ''), count(*)
    from gioia_private.command_requests
    where operation = 'owner_unsubscribe_subscriber'
    group by state, http_status, error_code
    order by state, http_status, error_code$$,
  $$values
    ('completed'::text, 200::smallint, ''::text, 1::bigint),
    ('failed'::text, 404::smallint, 'SUBSCRIBER_NOT_FOUND'::text, 1::bigint),
    ('failed'::text, 409::smallint, 'SUBSCRIBER_NOT_UNSUBSCRIBABLE'::text, 1::bigint),
    ('failed'::text, 409::smallint, 'VERSION_CONFLICT'::text, 1::bigint)
  $$,
  'success and bounded failure outcomes are persisted deterministically'
);
select ok(
  pg_get_functiondef(
    'gioia_private.owner_unsubscribe_subscriber(uuid,text,bytea,uuid,integer)'::regprocedure
  ) ~* '\mfor[[:space:]]+update\M'
  and pg_get_functiondef(
    'gioia_private.owner_unsubscribe_subscriber(uuid,text,bytea,uuid,integer)'::regprocedure
  ) ~ 'subscriber\.version[[:space:]]*=[[:space:]]*p_expected_version',
  'the command locks one subscriber and compares the expected version'
);
select ok(
  not exists (
    select 1 from gioia_private.command_requests
    where response_snapshot::text like '%@subscriber-command.test%'
  )
  and not exists (
    select 1 from gioia_private.domain_change_log
    where to_jsonb(domain_change_log)::text like '%@subscriber-command.test%'
  ),
  'command responses and audit rows exclude subscriber email values'
);
select is(
  (select count(*) from gioia_private.email_outbox), 0::bigint,
  'owner unsubscribe enqueues no email'
);

select * from finish();

rollback;

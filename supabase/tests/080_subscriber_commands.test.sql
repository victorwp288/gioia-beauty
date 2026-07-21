begin;

grant app_runtime to postgres;
grant usage on schema extensions to app_runtime;

set local search_path = extensions, public, pg_catalog;

select plan(18);

set local role app_runtime;

select results_eq(
  $actual$
    select command.http_status, command.result ->> 'code', command.replayed
    from gioia_private.subscribe_public_newsletter(
      decode(repeat('11', 32), 'hex'), 'subscribe:test:0001',
      decode(repeat('21', 32), 'hex'), '  Reader@Subscriber.Test  '
    ) as command
  $actual$,
  $expected$ values (202::smallint, 'REQUEST_ACCEPTED'::text, false) $expected$,
  'public subscribe returns a non-enumerating accepted response'
);

select results_eq(
  $actual$
    select command.http_status, command.result ->> 'code', command.replayed
    from gioia_private.subscribe_public_newsletter(
      decode(repeat('11', 32), 'hex'), 'subscribe:test:0001',
      decode(repeat('21', 32), 'hex'), '  Reader@Subscriber.Test  '
    ) as command
  $actual$,
  $expected$ values (202::smallint, 'REQUEST_ACCEPTED'::text, true) $expected$,
  'an identical subscribe command replays the accepted response'
);

select throws_ok(
  $$select * from gioia_private.subscribe_public_newsletter(
    decode(repeat('11', 32), 'hex'), 'subscribe:test:0001',
    decode(repeat('22', 32), 'hex'), 'reader@subscriber.test'
  )$$,
  'PT409', 'IDEMPOTENCY_KEY_REUSED',
  'subscribe idempotency keys reject a changed fingerprint'
);

select results_eq(
  $actual$
    select command.http_status, command.result ->> 'code', command.replayed
    from gioia_private.subscribe_public_newsletter(
      decode(repeat('12', 32), 'hex'), 'subscribe:test:0002',
      decode(repeat('23', 32), 'hex'), 'reader@subscriber.test'
    ) as command
  $actual$,
  $expected$ values (202::smallint, 'REQUEST_ACCEPTED'::text, false) $expected$,
  'an existing email is accepted without revealing its presence'
);

select results_eq(
  $actual$
    select command.http_status, command.result ->> 'code', command.replayed
    from gioia_private.subscribe_public_newsletter(
      decode(repeat('13', 32), 'hex'), 'subscribe:test:bad1',
      decode(repeat('24', 32), 'hex'), 'invalid'
    ) as command
  $actual$,
  $expected$ values (400::smallint, 'PUBLIC_EMAIL_INVALID'::text, false) $expected$,
  'the SQL boundary rejects an invalid email'
);

select results_eq(
  $actual$
    select command.http_status, command.result ->> 'code', command.replayed
    from gioia_private.subscribe_public_newsletter(
      decode(repeat('13', 32), 'hex'), 'subscribe:test:bad1',
      decode(repeat('24', 32), 'hex'), 'invalid'
    ) as command
  $actual$,
  $expected$ values (400::smallint, 'PUBLIC_EMAIL_INVALID'::text, true) $expected$,
  'an invalid subscribe replay preserves its stored error outcome'
);

reset role;

select results_eq(
  $$select email::text, status, source, consent_source, consent_policy_version
    from gioia_private.newsletter_subscribers$$,
  $$values (
    'reader@subscriber.test'::text, 'pending'::text, 'public'::text,
    'public_form'::text, 'newsletter-consent-v1'::text
  )$$,
  'email normalization and consent provenance are server-derived'
);

select is(
  (select count(*) from gioia_private.newsletter_subscribers), 1::bigint,
  'operation races converge on one normalized subscriber row'
);
select is(
  (select count(*) from gioia_private.email_outbox), 1::bigint,
  'duplicate subscribe calls enqueue one confirmation snapshot'
);
select is(
  (select count(*) from gioia_private.domain_change_log), 1::bigint,
  'duplicate subscribe calls append one PII-minimized domain change'
);

do $setup$
begin
  perform set_config(
    'gioia.test_subscriber_id',
    (select id::text from gioia_private.newsletter_subscribers), true
  );
  perform set_config('gioia.test_confirm_token', token.token_id::text, true),
    set_config('gioia.test_confirm_version', token.subscriber_version::text, true),
    set_config('gioia.test_confirm_token_version', token.token_version::text, true),
    set_config('gioia.test_confirm_issued', token.issued_at::text, true),
    set_config('gioia.test_confirm_expires', token.expires_at::text, true),
    set_config('gioia.test_confirm_key', token.signing_key_id, true)
  from gioia_private.newsletter_action_tokens as token
  where token.purpose = 'newsletter_confirm';
end
$setup$;

set local role app_runtime;

select results_eq(
  $actual$
    select command.http_status, command.result ->> 'code'
    from gioia_private.confirm_public_newsletter(
      current_setting('gioia.test_subscriber_id')::uuid,
      current_setting('gioia.test_confirm_version')::integer,
      current_setting('gioia.test_confirm_token')::uuid,
      current_setting('gioia.test_confirm_token_version')::integer,
      current_setting('gioia.test_confirm_issued')::timestamptz,
      current_setting('gioia.test_confirm_expires')::timestamptz,
      current_setting('gioia.test_confirm_key'),
      decode(repeat('31', 32), 'hex'), 'confirm:test:0001',
      decode(repeat('41', 32), 'hex')
    ) as command
  $actual$,
  $expected$ values (202::smallint, 'REQUEST_ACCEPTED'::text) $expected$,
  'verified confirmation activates through a non-enumerating boundary'
);

reset role;
do $unsubscribe_token$
begin
  perform set_config('gioia.test_unsubscribe_token', token.token_id::text, true),
    set_config('gioia.test_unsubscribe_version', token.subscriber_version::text, true),
    set_config('gioia.test_unsubscribe_token_version', token.token_version::text, true),
    set_config('gioia.test_unsubscribe_issued', token.issued_at::text, true),
    set_config('gioia.test_unsubscribe_expires', token.expires_at::text, true),
    set_config('gioia.test_unsubscribe_key', token.signing_key_id, true)
  from gioia_private.newsletter_action_tokens as token
  where token.purpose = 'newsletter_unsubscribe';
end
$unsubscribe_token$;
set local role app_runtime;

select results_eq(
  $actual$
    select command.http_status, command.result ->> 'code'
    from gioia_private.unsubscribe_public_newsletter(
      current_setting('gioia.test_subscriber_id')::uuid,
      current_setting('gioia.test_unsubscribe_version')::integer,
      current_setting('gioia.test_unsubscribe_token')::uuid,
      current_setting('gioia.test_unsubscribe_token_version')::integer,
      current_setting('gioia.test_unsubscribe_issued')::timestamptz,
      current_setting('gioia.test_unsubscribe_expires')::timestamptz,
      current_setting('gioia.test_unsubscribe_key'),
      decode(repeat('32', 32), 'hex'), 'unsubscribe:test:0001',
      decode(repeat('42', 32), 'hex')
    ) as command
  $actual$,
  $expected$ values (202::smallint, 'REQUEST_ACCEPTED'::text) $expected$,
  'verified unsubscribe uses the same accepted response'
);

select results_eq(
  $actual$
    select command.http_status, command.result ->> 'code'
    from gioia_private.unsubscribe_public_newsletter(
      '49999999-0000-4000-8000-000000000099',
      1, '49999999-0000-4000-8000-000000000098', 1,
      '2035-01-01T00:00:00Z', '2035-01-02T00:00:00Z', 'local_1',
      decode(repeat('33', 32), 'hex'), 'unsubscribe:test:0002',
      decode(repeat('43', 32), 'hex')
    ) as command
  $actual$,
  $expected$ values (202::smallint, 'REQUEST_ACCEPTED'::text) $expected$,
  'unknown unsubscribe tokens do not enumerate subscribers'
);

-- gioia-remote-pgtap-statement-timestamp-boundary
select results_eq(
  $actual$
    select command.http_status, command.result ->> 'code'
    from gioia_private.subscribe_public_newsletter(
      decode(repeat('14', 32), 'hex'), 'subscribe:test:0003',
      decode(repeat('25', 32), 'hex'), 'reader@subscriber.test'
    ) as command
  $actual$,
  $expected$ values (202::smallint, 'REQUEST_ACCEPTED'::text) $expected$,
  'an unsubscribed address starts a fresh double-opt-in cycle'
);

reset role;

select results_eq(
  $$select status, confirmed_at is null, unsubscribed_at is null, version
    from gioia_private.newsletter_subscribers$$,
  $$values ('pending'::text, true, true, 4)$$,
  're-subscription clears old confirmation evidence and advances version'
);
select is(
  (select count(*) from gioia_private.email_outbox), 2::bigint,
  're-subscription enqueues a version-distinct confirmation'
);

set local role app_runtime;
do $commands$
begin
  perform * from gioia_private.unsubscribe_public_newsletter(
    current_setting('gioia.test_subscriber_id')::uuid,
    1, '49999999-0000-4000-8000-000000000097', 1,
    '2035-01-01T00:00:00Z', '2035-01-02T00:00:00Z', 'local_1',
    decode(repeat('34', 32), 'hex'), 'unsubscribe:test:0003',
    decode(repeat('44', 32), 'hex')
  );
  perform * from gioia_private.claim_email_outbox(
    'worker:test', 25::smallint, 120::smallint
  );
end
$commands$;
reset role;

select results_eq(
  $$select status, attempt_count, last_error_code
    from gioia_private.email_outbox order by aggregate_version$$,
  $$values
    ('dead_letter'::text, 1::smallint, 'AGGREGATE_STATE_STALE'::text),
    ('sending'::text, 1::smallint, null::text)
  $$,
  'an unverified unsubscribe cannot invalidate the current confirmation snapshot'
);

select ok(
  not exists (
    select 1 from gioia_private.domain_change_log
    where to_jsonb(domain_change_log)::text like '%@subscriber.test%'
  ),
  'subscriber domain changes never store email values'
);

select * from finish();

rollback;

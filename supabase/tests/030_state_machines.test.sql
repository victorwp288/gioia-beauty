begin;

set local search_path = extensions, public, pg_catalog;

select plan(14);

select lives_ok(
  $sql$
    insert into gioia_private.newsletter_subscribers (
      id, email, status, source, consent_at, consent_source, consent_policy_version
    ) values (
      '40000000-0000-4000-8000-000000000001', 'reader@subscriber.test',
      'pending', 'public', statement_timestamp(), 'website', '2026-07'
    )
  $sql$,
  'a consented pending subscriber is accepted'
);

select throws_ok(
  $sql$
    insert into gioia_private.newsletter_subscribers (
      email, status, source, consent_at, consent_source, consent_policy_version
    ) values (
      'Upper@subscriber.test', 'pending', 'public', statement_timestamp(),
      'website', '2026-07'
    )
  $sql$,
  '23514', null,
  'subscriber email must be normalized'
);

select lives_ok(
  $$update gioia_private.newsletter_subscribers
    set status = 'active', confirmed_at = statement_timestamp()
    where id = '40000000-0000-4000-8000-000000000001'$$,
  'a pending subscriber can be confirmed'
);

select throws_ok(
  $$update gioia_private.newsletter_subscribers
    set consent_policy_version = 'changed'
    where id = '40000000-0000-4000-8000-000000000001'$$,
  '23514', 'Subscriber consent evidence is immutable',
  'subscriber consent evidence is immutable after capture'
);

select throws_ok(
  $$update gioia_private.newsletter_subscribers
    set status = 'pending'
    where id = '40000000-0000-4000-8000-000000000001'$$,
  '23514', 'Invalid subscriber status transition',
  'active subscribers cannot transition backward to pending'
);

select throws_ok(
  $$update gioia_private.newsletter_subscribers
    set email = 'changed@subscriber.test'
    where id = '40000000-0000-4000-8000-000000000001'$$,
  '23514', 'Subscriber identity and provenance are immutable',
  'subscriber identity is immutable'
);

select lives_ok(
  $sql$
    insert into gioia_private.command_requests (
      id, operation, principal_scope_hash, idempotency_key,
      request_fingerprint, expires_at
    ) values (
      '60000000-0000-4000-8000-000000000001', 'create_booking',
      decode(repeat('11', 32), 'hex'), 'request:test:0001',
      decode(repeat('22', 32), 'hex'), statement_timestamp() + interval '1 day'
    )
  $sql$,
  'a valid in-progress idempotency request is accepted'
);

select throws_ok(
  $sql$
    insert into gioia_private.command_requests (
      operation, principal_scope_hash, idempotency_key,
      request_fingerprint, expires_at
    ) values (
      'create_booking', decode(repeat('33', 32), 'hex'), 'short',
      decode(repeat('44', 32), 'hex'), statement_timestamp() + interval '1 day'
    )
  $sql$,
  '23514', null,
  'idempotency keys must satisfy the stable bounded format'
);

select throws_ok(
  $sql$
    insert into gioia_private.command_requests (
      operation, principal_scope_hash, idempotency_key,
      request_fingerprint, expires_at
    ) values (
      'create_booking', decode(repeat('11', 32), 'hex'), 'request:test:0001',
      decode(repeat('55', 32), 'hex'), statement_timestamp() + interval '1 day'
    )
  $sql$,
  '23505', null,
  'the same operation, principal, and idempotency key is unique'
);

select lives_ok(
  $sql$
    update gioia_private.command_requests
    set state = 'completed', resource_kind = 'schedule_entry',
      resource_id = '10000000-0000-4000-8000-000000000009', http_status = 201,
      response_snapshot = '{"code":"BOOKING_CREATED",
        "resource_id":"10000000-0000-4000-8000-000000000009"}'::jsonb,
      completed_at = statement_timestamp()
    where id = '60000000-0000-4000-8000-000000000001'
  $sql$,
  'an in-progress command can complete with a redacted snapshot'
);

select throws_ok(
  $$update gioia_private.command_requests
    set state = 'completed'
    where id = '60000000-0000-4000-8000-000000000001'$$,
  '23514', 'Completed command requests are immutable',
  'completed idempotency records are immutable'
);

select throws_ok(
  $sql$
    insert into gioia_private.command_requests (
      operation, principal_scope_hash, idempotency_key, request_fingerprint,
      state, http_status, error_code, response_snapshot, expires_at, completed_at
    ) values (
      'create_booking', decode(repeat('66', 32), 'hex'), 'request:test:0002',
      decode(repeat('77', 32), 'hex'), 'failed', 400, 'BAD_REQUEST',
      '{"code":"BAD_REQUEST","email":"forbidden@request.test"}'::jsonb,
      statement_timestamp() + interval '1 day', statement_timestamp()
    )
  $sql$,
  '23514', null,
  'command response snapshots reject PII-bearing fields'
);

select lives_ok(
  $sql$
    insert into gioia_private.domain_change_log (
      aggregate_kind, aggregate_id, aggregate_version,
      change_kind, source, changed_fields
    ) values (
      'schedule_entry', '10000000-0000-4000-8000-000000000009', 1,
      'create', 'system', array['status']
    )
  $sql$,
  'a bounded system audit record is accepted'
);

select throws_ok(
  $sql$
    insert into gioia_private.domain_change_log (
      aggregate_kind, aggregate_id, aggregate_version,
      change_kind, source, changed_fields
    ) values (
      'schedule_entry', '10000000-0000-4000-8000-000000000010', 1,
      'create', 'public', array['status']
    )
  $sql$,
  '23514', null,
  'public audit records require a command-request link'
);

select * from finish();

rollback;

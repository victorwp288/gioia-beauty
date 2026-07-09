begin;

set local search_path = extensions, public, pg_catalog;

select plan(14);

select lives_ok(
  $sql$
    insert into gioia_private.email_outbox (
      id, aggregate_kind, aggregate_id, aggregate_version,
      recipient_kind, recipient_address, template_kind, template_data,
      idempotency_key
    ) values (
      '50000000-0000-4000-8000-000000000001', 'schedule_entry',
      '10000000-0000-4000-8000-000000000001', 1,
      'customer', 'client@outbox.test', 'booking_customer',
      '{"client_name":"Cliente Test","local_date":"2035-03-10",
        "start_minutes":540,"service_duration_minutes":30,
        "service_name":"Manicure","variant_name":"Manicure"}'::jsonb,
      'booking:customer:0001'
    )
  $sql$,
  'a bounded booking-email snapshot is accepted'
);

select throws_ok(
  $sql$
    insert into gioia_private.email_outbox (
      aggregate_kind, aggregate_id, aggregate_version,
      recipient_kind, recipient_address, template_kind, template_data,
      idempotency_key
    ) values (
      'schedule_entry', '10000000-0000-4000-8000-000000000002', 1,
      'customer', 'extra@outbox.test', 'booking_customer',
      '{"client_name":"Cliente Test","local_date":"2035-03-10",
        "start_minutes":540,"service_duration_minutes":30,
        "service_name":"Manicure","variant_name":"Manicure",
        "client_email":"forbidden@outbox.test"}'::jsonb,
      'booking:customer:0002'
    )
  $sql$,
  '23514', null,
  'outbox snapshots reject unapproved customer fields'
);

select throws_ok(
  $sql$
    insert into gioia_private.email_outbox (
      aggregate_kind, aggregate_id, aggregate_version,
      recipient_kind, recipient_address, template_kind, template_data,
      idempotency_key, status
    ) values (
      'schedule_entry', '10000000-0000-4000-8000-000000000003', 1,
      'customer', 'invalid@outbox.test', 'booking_customer',
      '{"client_name":"Cliente Test","local_date":"2035-03-10",
        "start_minutes":540,"service_duration_minutes":30,
        "service_name":"Manicure","variant_name":"Manicure"}'::jsonb,
      'booking:customer:0003', 'sent'
    )
  $sql$,
  '23514', null,
  'outbox delivery state must be internally consistent'
);

select throws_ok(
  $$update gioia_private.email_outbox
    set recipient_address = 'changed@outbox.test'
    where id = '50000000-0000-4000-8000-000000000001'$$,
  '23514', 'Outbox recipient and template snapshots are immutable',
  'outbox recipient snapshots are immutable'
);

select lives_ok(
  $$update gioia_private.email_outbox
    set status = 'sending', attempt_count = 1,
      locked_at = statement_timestamp(), locked_by = 'worker-test',
      lease_expires_at = statement_timestamp() + interval '1 minute'
    where id = '50000000-0000-4000-8000-000000000001'$$,
  'pending outbox work can be claimed with a bounded lease'
);

select throws_ok(
  $$update gioia_private.email_outbox
    set attempt_count = 3
    where id = '50000000-0000-4000-8000-000000000001'$$,
  '23514', 'Outbox attempt count must advance monotonically',
  'outbox attempt count cannot skip retries'
);

select lives_ok(
  $$update gioia_private.email_outbox
    set status = 'sent', provider_message_id = 'msg_test_0001',
      sent_at = statement_timestamp(), locked_at = null, locked_by = null,
      lease_expires_at = null
    where id = '50000000-0000-4000-8000-000000000001'$$,
  'claimed outbox work can transition to sent'
);

select throws_ok(
  $$update gioia_private.email_outbox
    set provider_message_id = 'msg_test_changed'
    where id = '50000000-0000-4000-8000-000000000001'$$,
  '23514', 'Provider message identity is immutable',
  'provider message identity is immutable'
);

select throws_ok(
  $$update gioia_private.email_outbox
    set status = 'failed'
    where id = '50000000-0000-4000-8000-000000000001'$$,
  '23514', 'Invalid outbox status transition',
  'sent email cannot transition backward to failed'
);

select lives_ok(
  $sql$
    insert into gioia_private.email_webhook_events (
      provider_event_id, provider_message_id, event_kind,
      payload_sha256, signature_verified
    ) values (
      'evt_test_0001', 'msg_test_0001', 'delivered',
      decode(repeat('aa', 32), 'hex'), true
    )
  $sql$,
  'verified webhook evidence is accepted'
);

select throws_ok(
  $sql$
    insert into gioia_private.email_webhook_events (
      provider_event_id, event_kind, payload_sha256, signature_verified
    ) values (
      'evt_test_0002', 'other', decode(repeat('bb', 32), 'hex'), false
    )
  $sql$,
  '23514', null,
  'unverified webhook evidence is rejected'
);

select throws_ok(
  $$update gioia_private.email_webhook_events
    set event_kind = 'bounced'
    where provider_event_id = 'evt_test_0001'$$,
  '23514', 'Webhook evidence is immutable',
  'webhook payload identity is immutable'
);

select lives_ok(
  $$update gioia_private.email_webhook_events
    set processed_at = statement_timestamp()
    where provider_event_id = 'evt_test_0001'$$,
  'an unprocessed webhook can be marked processed'
);

select throws_ok(
  $$update gioia_private.email_webhook_events
    set processed_at = processed_at
    where provider_event_id = 'evt_test_0001'$$,
  '23514', 'Processed webhook events are immutable',
  'processed webhook evidence is immutable'
);

select * from finish();

rollback;

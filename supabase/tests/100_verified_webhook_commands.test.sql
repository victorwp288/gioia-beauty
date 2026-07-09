begin;

grant app_runtime to postgres;

set local search_path = extensions, public, pg_catalog;

select plan(20);

set local role app_runtime;

select results_eq(
  $$select http_status, result ->> 'code'
    from gioia_private.subscribe_public_newsletter(
      decode(repeat('61', 32), 'hex'), 'webhook:subscribe:0001',
      decode(repeat('71', 32), 'hex'), 'webhook-one@example.test'
    )$$,
  $$values (202::smallint, 'REQUEST_ACCEPTED'::text)$$,
  'webhook fixture starts through the public subscriber boundary'
);

reset role;

do $capture_first$
begin
  perform set_config(
    'gioia.webhook_subscriber_one',
    (select id::text from gioia_private.newsletter_subscribers
      where email = 'webhook-one@example.test'), true
  );
  perform set_config(
    'gioia.webhook_outbox_one',
    (select id::text from gioia_private.email_outbox
      where recipient_address = 'webhook-one@example.test'), true
  );
end
$capture_first$;

set local role app_runtime;

select results_eq(
  $actual$
    with claimed as (
      select * from gioia_private.claim_email_outbox(
        'worker:webhook-one', 1::smallint, 120::smallint
      )
      where outbox_id = current_setting('gioia.webhook_outbox_one')::uuid
    )
    select completion.delivery_status, completion.current_version
    from claimed
    cross join lateral gioia_private.complete_email_outbox_success(
      claimed.outbox_id, claimed.expected_version,
      'worker:webhook-one', 'msg_webhook_one'
    ) as completion
  $actual$,
  $$values ('sent'::text, 3)$$,
  'claimed confirmation records provider success'
);

select results_eq(
  $$select http_status, result ->> 'code'
    from gioia_private.confirm_public_newsletter(
      current_setting('gioia.webhook_subscriber_one')::uuid,
      decode(repeat('62', 32), 'hex'), 'webhook:confirm:0001',
      decode(repeat('72', 32), 'hex')
    )$$,
  $$values (202::smallint, 'REQUEST_ACCEPTED'::text)$$,
  'double opt-in advances the subscriber beyond the outbox generation'
);

select results_eq(
  $$select processing_state, replayed, error_code
    from gioia_private.process_verified_email_webhook(
      'evt_webhook_bounce', 'msg_webhook_one', 'bounced',
      decode(repeat('81', 32), 'hex'), statement_timestamp()
    )$$,
  $$values ('processed'::text, false, null::text)$$,
  'a verified bounce is processed once'
);

reset role;

select results_eq(
  $$select subscriber.status, subscriber.version, outbox.status
    from gioia_private.newsletter_subscribers as subscriber
    join gioia_private.email_outbox as outbox
      on outbox.aggregate_id = subscriber.id
    where subscriber.id = current_setting('gioia.webhook_subscriber_one')::uuid$$,
  $$values ('bounced'::text, 3, 'bounced'::text)$$,
  'active N+1 subscriber and sent outbox both become bounced'
);

set local role app_runtime;

select results_eq(
  $$select processing_state, replayed
    from gioia_private.process_verified_email_webhook(
      'evt_webhook_bounce', 'msg_webhook_one', 'bounced',
      decode(repeat('81', 32), 'hex'), statement_timestamp()
    )$$,
  $$values ('processed'::text, true)$$,
  'exact webhook replay is deduplicated'
);

select throws_ok(
  $$select * from gioia_private.process_verified_email_webhook(
    'evt_webhook_bounce', 'msg_webhook_one', 'bounced',
    decode(repeat('82', 32), 'hex'), statement_timestamp()
  )$$,
  'PT409', 'WEBHOOK_EVENT_ID_REUSED',
  'an event ID cannot be reused with another digest'
);

select results_eq(
  $$select processing_state, replayed
    from gioia_private.process_verified_email_webhook(
      'evt_webhook_complaint', 'msg_webhook_one', 'complained',
      decode(repeat('83', 32), 'hex'), statement_timestamp()
    )$$,
  $$values ('processed'::text, false)$$,
  'a complaint can follow a bounce for the same provider message'
);

reset role;

select results_eq(
  $$select subscriber.status, subscriber.version, outbox.status
    from gioia_private.newsletter_subscribers as subscriber
    join gioia_private.email_outbox as outbox
      on outbox.aggregate_id = subscriber.id
    where subscriber.id = current_setting('gioia.webhook_subscriber_one')::uuid$$,
  $$values ('complained'::text, 4, 'complained'::text)$$,
  'bounced N+2 subscriber and outbox both become complained'
);

set local role app_runtime;

select results_eq(
  $$select processing_state, replayed, error_code
    from gioia_private.process_verified_email_webhook(
      'evt_webhook_other', null, 'other',
      decode(repeat('84', 32), 'hex'), statement_timestamp()
    )$$,
  $$values ('processed'::text, false, null::text)$$,
  'non-delivery webhook kinds are recorded without a message ID'
);

select results_eq(
  $$select processing_state, replayed, error_code
    from gioia_private.process_verified_email_webhook(
      'evt_webhook_missing', null, 'bounced',
      decode(repeat('85', 32), 'hex'), statement_timestamp()
    )$$,
  $$values ('error'::text, false, 'MESSAGE_ID_REQUIRED'::text)$$,
  'delivery events without a message ID retain a bounded error'
);

select results_eq(
  $$select processing_state, replayed, error_code
    from gioia_private.process_verified_email_webhook(
      'evt_webhook_missing', null, 'bounced',
      decode(repeat('85', 32), 'hex'), statement_timestamp()
    )$$,
  $$values ('error'::text, true, 'MESSAGE_ID_REQUIRED'::text)$$,
  'an errored event replays without a second insert'
);

select results_eq(
  $$select processing_state, error_code
    from gioia_private.process_verified_email_webhook(
      'evt_webhook_unknown', 'msg_unknown', 'delivered',
      decode(repeat('86', 32), 'hex'), statement_timestamp()
    )$$,
  $$values ('error'::text, 'PROVIDER_MESSAGE_NOT_FOUND'::text)$$,
  'unknown provider messages are recorded without updating an outbox row'
);

select results_eq(
  $$select http_status from gioia_private.subscribe_public_newsletter(
    decode(repeat('63', 32), 'hex'), 'webhook:subscribe:0002',
    decode(repeat('73', 32), 'hex'), 'webhook-two@example.test'
  )$$,
  $$values (202::smallint)$$,
  'a second subscriber provides a stale-generation fixture'
);

reset role;

do $capture_second$
begin
  perform set_config(
    'gioia.webhook_subscriber_two',
    (select id::text from gioia_private.newsletter_subscribers
      where email = 'webhook-two@example.test'), true
  );
  perform set_config(
    'gioia.webhook_outbox_two',
    (select id::text from gioia_private.email_outbox
      where recipient_address = 'webhook-two@example.test'), true
  );
end
$capture_second$;

set local role app_runtime;

select results_eq(
  $actual$
    with claimed as (
      select * from gioia_private.claim_email_outbox(
        'worker:webhook-two', 1::smallint, 120::smallint
      )
      where outbox_id = current_setting('gioia.webhook_outbox_two')::uuid
    )
    select completion.delivery_status
    from claimed
    cross join lateral gioia_private.complete_email_outbox_success(
      claimed.outbox_id, claimed.expected_version,
      'worker:webhook-two', 'msg_webhook_two_old'
    ) as completion
  $actual$,
  $$values ('sent'::text)$$,
  'the old confirmation generation is delivered before re-subscribe'
);

select results_eq(
  $$select http_status from gioia_private.unsubscribe_public_newsletter(
    current_setting('gioia.webhook_subscriber_two')::uuid,
    decode(repeat('64', 32), 'hex'), 'webhook:unsubscribe:0002',
    decode(repeat('74', 32), 'hex')
  )$$,
  $$values (202::smallint)$$,
  'the old generation is unsubscribed'
);

select results_eq(
  $$select http_status from gioia_private.subscribe_public_newsletter(
    decode(repeat('65', 32), 'hex'), 'webhook:resubscribe:0002',
    decode(repeat('75', 32), 'hex'), 'webhook-two@example.test'
  )$$,
  $$values (202::smallint)$$,
  're-subscribe creates a newer pending generation'
);

select results_eq(
  $$select processing_state from gioia_private.process_verified_email_webhook(
    'evt_webhook_old_bounce', 'msg_webhook_two_old', 'bounced',
    decode(repeat('87', 32), 'hex'), statement_timestamp()
  )$$,
  $$values ('processed'::text)$$,
  'a late old-generation bounce is recorded'
);

reset role;

select results_eq(
  $$select status, version from gioia_private.newsletter_subscribers
    where id = current_setting('gioia.webhook_subscriber_two')::uuid$$,
  $$values ('pending'::text, 3)$$,
  'a stale old-generation webhook cannot poison re-subscription'
);

select is(
  (select count(*) from gioia_private.email_webhook_events), 6::bigint,
  'provider event IDs are inserted once across success, error, and replay paths'
);

select * from finish();

rollback;

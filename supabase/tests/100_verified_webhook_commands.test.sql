begin;
grant app_runtime to postgres;
grant usage on schema extensions to app_runtime;
set local search_path = extensions, public, pg_catalog;
select plan(21);
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
  perform set_config('gioia.webhook_confirm_one', token.token_id::text, true),
    set_config('gioia.webhook_confirm_one_version', token.subscriber_version::text, true),
    set_config('gioia.webhook_confirm_one_token_version', token.token_version::text, true),
    set_config('gioia.webhook_confirm_one_issued', token.issued_at::text, true),
    set_config('gioia.webhook_confirm_one_expires', token.expires_at::text, true),
    set_config('gioia.webhook_confirm_one_key', token.signing_key_id, true)
  from gioia_private.newsletter_action_tokens as token
  where token.subscriber_id = current_setting('gioia.webhook_subscriber_one')::uuid
    and token.purpose = 'newsletter_confirm';
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
    , attempt as (
      select provider.* from claimed cross join lateral
        gioia_private.begin_email_outbox_provider_attempt(
          claimed.outbox_id, claimed.expected_version, 'worker:webhook-one'
        ) as provider
    ) select completion.delivery_status, completion.current_version
    from attempt
    cross join lateral gioia_private.complete_email_outbox_success(
      attempt.outbox_id, attempt.current_version,
      'worker:webhook-one', 'msg_webhook_one'
    ) as completion
  $actual$,
  $$values ('sent'::text, 4)$$,
  'claimed confirmation records provider success'
);
select results_eq(
  $$select http_status, result ->> 'code'
    from gioia_private.confirm_public_newsletter(
      current_setting('gioia.webhook_subscriber_one')::uuid,
      current_setting('gioia.webhook_confirm_one_version')::integer,
      current_setting('gioia.webhook_confirm_one')::uuid,
      current_setting('gioia.webhook_confirm_one_token_version')::integer,
      current_setting('gioia.webhook_confirm_one_issued')::timestamptz,
      current_setting('gioia.webhook_confirm_one_expires')::timestamptz,
      current_setting('gioia.webhook_confirm_one_key'),
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
  perform set_config('gioia.webhook_confirm_two', token.token_id::text, true),
    set_config('gioia.webhook_confirm_two_version', token.subscriber_version::text, true),
    set_config('gioia.webhook_confirm_two_token_version', token.token_version::text, true),
    set_config('gioia.webhook_confirm_two_issued', token.issued_at::text, true),
    set_config('gioia.webhook_confirm_two_expires', token.expires_at::text, true),
    set_config('gioia.webhook_confirm_two_key', token.signing_key_id, true)
  from gioia_private.newsletter_action_tokens as token
  where token.subscriber_id = current_setting('gioia.webhook_subscriber_two')::uuid
    and token.purpose = 'newsletter_confirm';
end
$capture_second$;
set local role app_runtime;
select results_eq(
  $actual$
    with claimed as (
      select * from gioia_private.claim_email_outbox(
        'worker:webhook-two', 1::smallint, 120::smallint
      ) where outbox_id = current_setting('gioia.webhook_outbox_two')::uuid
    ), attempt as (
      select provider.* from claimed cross join lateral
        gioia_private.begin_email_outbox_provider_attempt(
          claimed.outbox_id, claimed.expected_version, 'worker:webhook-two'
        ) as provider
    ) select completion.delivery_status from attempt
    cross join lateral gioia_private.complete_email_outbox_success(
      attempt.outbox_id, attempt.current_version,
      'worker:webhook-two', 'msg_webhook_two_old'
    ) as completion
  $actual$,
  $$values ('sent'::text)$$,
  'the old confirmation generation is delivered before re-subscribe'
);
select results_eq(
  $$select http_status from gioia_private.confirm_public_newsletter(
    current_setting('gioia.webhook_subscriber_two')::uuid,
    current_setting('gioia.webhook_confirm_two_version')::integer,
    current_setting('gioia.webhook_confirm_two')::uuid,
    current_setting('gioia.webhook_confirm_two_token_version')::integer,
    current_setting('gioia.webhook_confirm_two_issued')::timestamptz,
    current_setting('gioia.webhook_confirm_two_expires')::timestamptz,
    current_setting('gioia.webhook_confirm_two_key'),
    decode(repeat('64', 32), 'hex'), 'webhook:confirm:0002',
    decode(repeat('74', 32), 'hex')
  )$$,
  $$values (202::smallint)$$,
  'the second subscriber confirms before unsubscribe'
);
reset role;
do $capture_unsubscribe_second$
begin
  perform set_config('gioia.webhook_unsubscribe_two', token.token_id::text, true),
    set_config('gioia.webhook_unsubscribe_two_version', token.subscriber_version::text, true),
    set_config('gioia.webhook_unsubscribe_two_token_version', token.token_version::text, true),
    set_config('gioia.webhook_unsubscribe_two_issued', token.issued_at::text, true),
    set_config('gioia.webhook_unsubscribe_two_expires', token.expires_at::text, true),
    set_config('gioia.webhook_unsubscribe_two_key', token.signing_key_id, true)
  from gioia_private.newsletter_action_tokens as token
  where token.subscriber_id = current_setting('gioia.webhook_subscriber_two')::uuid
    and token.purpose = 'newsletter_unsubscribe';
end
$capture_unsubscribe_second$;
set local role app_runtime;
select results_eq(
  $$select http_status from gioia_private.unsubscribe_public_newsletter(
    current_setting('gioia.webhook_subscriber_two')::uuid,
    current_setting('gioia.webhook_unsubscribe_two_version')::integer,
    current_setting('gioia.webhook_unsubscribe_two')::uuid,
    current_setting('gioia.webhook_unsubscribe_two_token_version')::integer,
    current_setting('gioia.webhook_unsubscribe_two_issued')::timestamptz,
    current_setting('gioia.webhook_unsubscribe_two_expires')::timestamptz,
    current_setting('gioia.webhook_unsubscribe_two_key'),
    decode(repeat('66', 32), 'hex'), 'webhook:unsubscribe:0002',
    decode(repeat('76', 32), 'hex')
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
  $$values ('pending'::text, 4)$$,
  'a stale old-generation webhook cannot poison re-subscription'
);
select results_eq(
  $$select count(*), count(*) filter (where provider_event_id = 'evt_webhook_unknown' and replay_attempt_count = 0 and replay_next_attempt_at is not null) from gioia_private.email_webhook_events$$,
  $$values (6::bigint, 1::bigint)$$,
  'provider events deduplicate and new unknown messages initialize replay eligibility'
);
select * from finish();
rollback;

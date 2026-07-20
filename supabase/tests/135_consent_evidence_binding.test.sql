begin;

set local search_path = extensions, public, pg_catalog;

select plan(11);

select is(
  (select count(*) from pg_catalog.pg_constraint
    where connamespace = 'gioia_private'::regnamespace
      and conname in (
        'newsletter_consent_cycles_artifact_evidence_fk',
        'newsletter_consent_events_cycle_identity_fk',
        'newsletter_consent_events_action_identity_fk',
        'email_outbox_newsletter_action_identity_fk'
      )),
  4::bigint,
  'all consent-evidence composite foreign keys exist'
);

select has_trigger(
  'gioia_private', 'newsletter_consent_cycles',
  'newsletter_consent_cycles_binding_guard',
  'consent cycles validate the current subscriber evidence at insertion'
);

insert into gioia_private.newsletter_subscribers (
  id, email, status, source, consent_at, consent_source, consent_policy_version
) values
  ('d1000000-0000-4000-8000-000000000001', 'binding-one@example.test',
   'pending', 'public', '2026-01-01T10:00:00Z', 'public_form',
   'newsletter-consent-v1'),
  ('d1000000-0000-4000-8000-000000000002', 'binding-two@example.test',
   'pending', 'public', '2026-01-02T10:00:00Z', 'public_form',
   'newsletter-consent-v1');

select throws_ok(
  $$insert into gioia_private.newsletter_consent_cycles (
      id, subscriber_id, subscriber_version, consent_at, consent_source,
      policy_version, artifact_version, artifact_sha256
    ) values (
      'd2000000-0000-4000-8000-000000000099',
      'd1000000-0000-4000-8000-000000000001', 2,
      '2026-01-01T10:00:00Z', 'public_form', 'newsletter-consent-v1',
      'newsletter-consent-v1.it-1', decode(repeat('a1', 32), 'hex')
    )$$,
  '23514', 'Consent cycle must match the current subscriber evidence',
  'a cycle cannot claim a non-current subscriber version'
);

select throws_ok(
  $$insert into gioia_private.newsletter_consent_cycles (
      id, subscriber_id, subscriber_version, consent_at, consent_source,
      policy_version, artifact_version, artifact_sha256
    ) values (
      'd2000000-0000-4000-8000-000000000098',
      'd1000000-0000-4000-8000-000000000001', 1,
      '2026-01-01T10:00:00Z', 'public_form', 'newsletter-consent-v1',
      'newsletter-consent-v1.it-1', decode(repeat('ff', 32), 'hex')
    )$$,
  '23503', null,
  'a cycle cannot pair an artifact version with a different digest'
);

insert into gioia_private.newsletter_consent_cycles (
  id, subscriber_id, subscriber_version, consent_at, consent_source,
  policy_version, artifact_version, artifact_sha256
) values
  ('d2000000-0000-4000-8000-000000000001',
   'd1000000-0000-4000-8000-000000000001', 1,
   '2026-01-01T10:00:00Z', 'public_form', 'newsletter-consent-v1',
   'newsletter-consent-v1.it-1', decode(repeat('a1', 32), 'hex')),
  ('d2000000-0000-4000-8000-000000000002',
   'd1000000-0000-4000-8000-000000000002', 1,
   '2026-01-02T10:00:00Z', 'public_form', 'newsletter-consent-v1',
   'newsletter-consent-v1.it-1', decode(repeat('a1', 32), 'hex'));

select is(
  (select count(*) from gioia_private.newsletter_consent_cycles),
  2::bigint,
  'exactly matching subscriber and artifact evidence is accepted'
);

select throws_ok(
  $$insert into gioia_private.newsletter_action_tokens (
      token_id, consent_cycle_id, subscriber_id, subscriber_version,
      purpose, signing_key_id, issued_at, expires_at
    ) values (
      'd3000000-0000-4000-8000-000000000099',
      'd2000000-0000-4000-8000-000000000001',
      'd1000000-0000-4000-8000-000000000002', 1,
      'newsletter_confirm', 'local_1',
      '2026-01-03T10:00:00Z', '2026-01-04T10:00:00Z'
    )$$,
  '23503', null,
  'an action token cannot mix a cycle with another subscriber'
);

insert into gioia_private.newsletter_action_tokens (
  token_id, consent_cycle_id, subscriber_id, subscriber_version,
  purpose, signing_key_id, issued_at, expires_at
) values
  ('d3000000-0000-4000-8000-000000000001',
   'd2000000-0000-4000-8000-000000000001',
   'd1000000-0000-4000-8000-000000000001', 1,
   'newsletter_confirm', 'local_1',
   '2026-01-03T10:00:00Z', '2026-01-04T10:00:00Z'),
  ('d3000000-0000-4000-8000-000000000002',
   'd2000000-0000-4000-8000-000000000002',
   'd1000000-0000-4000-8000-000000000002', 1,
   'newsletter_confirm', 'local_1',
   '2026-01-03T11:00:00Z', '2026-01-04T11:00:00Z');

insert into gioia_private.command_requests (
  id, operation, principal_scope_hash, idempotency_key,
  request_fingerprint, expires_at
) values (
  'd4000000-0000-4000-8000-000000000001', 'consent_binding_test',
  decode(repeat('11', 32), 'hex'), 'consent:binding:0001',
  decode(repeat('22', 32), 'hex'), statement_timestamp() + interval '1 hour'
);

select throws_ok(
  $$insert into gioia_private.newsletter_consent_events (
      consent_cycle_id, subscriber_id, subscriber_version, event_kind,
      command_request_id
    ) values (
      'd2000000-0000-4000-8000-000000000001',
      'd1000000-0000-4000-8000-000000000002', 1, 'requested',
      'd4000000-0000-4000-8000-000000000001'
    )$$,
  '23503', null,
  'an event cannot mix a cycle with another subscriber'
);

select throws_ok(
  $$insert into gioia_private.newsletter_consent_events (
      consent_cycle_id, subscriber_id, subscriber_version, event_kind,
      action_token_id, command_request_id
    ) values (
      'd2000000-0000-4000-8000-000000000001',
      'd1000000-0000-4000-8000-000000000001', 1, 'confirmed',
      'd3000000-0000-4000-8000-000000000002',
      'd4000000-0000-4000-8000-000000000001'
    )$$,
  '23503', null,
  'an event action must belong to the same cycle and subscriber'
);

insert into gioia_private.newsletter_consent_events (
  consent_cycle_id, subscriber_id, subscriber_version, event_kind,
  action_token_id, command_request_id
) values (
  'd2000000-0000-4000-8000-000000000001',
  'd1000000-0000-4000-8000-000000000001', 1, 'confirmed',
  'd3000000-0000-4000-8000-000000000001',
  'd4000000-0000-4000-8000-000000000001'
);

select is(
  (select count(*) from gioia_private.newsletter_consent_events),
  1::bigint,
  'an event with one relational consent identity is accepted'
);

select throws_ok(
  $$insert into gioia_private.email_outbox (
      aggregate_kind, aggregate_id, aggregate_version, recipient_kind,
      recipient_address, template_kind, template_data,
      newsletter_action_token_id, idempotency_key
    ) values (
      'subscriber', 'd1000000-0000-4000-8000-000000000002', 1,
      'subscriber', 'binding-two@example.test', 'newsletter_confirmation',
      jsonb_build_object(
        'policyVersion', 'newsletter-consent-v1',
        'consentArtifactVersion', 'newsletter-consent-v1.it-1',
        'consentArtifactSha256', repeat('a1', 32),
        'action', jsonb_build_object(
          'version', 1, 'purpose', 'newsletter_confirm',
          'tokenId', 'd3000000-0000-4000-8000-000000000001',
          'issuedAt', '2026-01-03T10:00:00.000Z',
          'expiresAt', '2026-01-04T10:00:00.000Z',
          'signingKeyId', 'local_1'
        )
      ), 'd3000000-0000-4000-8000-000000000001',
      'consent:binding:outbox:bad'
    )$$,
  '23503', null,
  'a newsletter outbox token must belong to its aggregate subscriber version'
);

insert into gioia_private.email_outbox (
  aggregate_kind, aggregate_id, aggregate_version, recipient_kind,
  recipient_address, template_kind, template_data,
  newsletter_action_token_id, idempotency_key
) values (
  'subscriber', 'd1000000-0000-4000-8000-000000000001', 1,
  'subscriber', 'binding-one@example.test', 'newsletter_confirmation',
  jsonb_build_object(
    'policyVersion', 'newsletter-consent-v1',
    'consentArtifactVersion', 'newsletter-consent-v1.it-1',
    'consentArtifactSha256', repeat('a1', 32),
    'action', jsonb_build_object(
      'version', 1, 'purpose', 'newsletter_confirm',
      'tokenId', 'd3000000-0000-4000-8000-000000000001',
      'issuedAt', '2026-01-03T10:00:00.000Z',
      'expiresAt', '2026-01-04T10:00:00.000Z', 'signingKeyId', 'local_1'
    )
  ), 'd3000000-0000-4000-8000-000000000001',
  'consent:binding:outbox:good'
);

select is(
  (select count(*) from gioia_private.email_outbox),
  1::bigint,
  'an outbox row with one relational action identity is accepted'
);

select * from finish();

rollback;

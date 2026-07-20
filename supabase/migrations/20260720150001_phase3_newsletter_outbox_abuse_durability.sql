begin;

set local lock_timeout = '5s';
set local statement_timeout = '30s';

create table gioia_private.newsletter_consent_artifacts (
  artifact_version text primary key,
  policy_version text not null,
  locale text not null default 'it-IT',
  form_copy text not null,
  confirmation_copy text not null,
  privacy_notice_url text not null,
  content_sha256 bytea not null,
  effective_at timestamptz not null,
  retired_at timestamptz,
  created_at timestamptz not null default statement_timestamp(),
  constraint newsletter_consent_artifact_version_format
    check (artifact_version ~ '^[a-z0-9][a-z0-9._-]{2,99}$'),
  constraint newsletter_consent_policy_version_format
    check (policy_version ~ '^[a-z0-9][a-z0-9._-]{2,99}$'),
  constraint newsletter_consent_locale_italian check (locale = 'it-IT'),
  constraint newsletter_consent_copy_bounded check (
    octet_length(form_copy) between 1 and 8192
    and octet_length(confirmation_copy) between 1 and 8192
    and octet_length(privacy_notice_url) between 8 and 2048
  ),
  constraint newsletter_consent_artifact_sha256 check (octet_length(content_sha256) = 32),
  constraint newsletter_consent_retirement_order
    check (retired_at is null or retired_at > effective_at)
);

create unique index newsletter_consent_artifacts_current_idx
  on gioia_private.newsletter_consent_artifacts ((retired_at is null))
  where retired_at is null;

create table gioia_private.newsletter_action_signing_keys (
  key_id text primary key,
  issue_enabled boolean not null default false,
  verify_until timestamptz not null,
  created_at timestamptz not null default statement_timestamp(),
  retired_at timestamptz,
  constraint newsletter_action_signing_key_id_format
    check (key_id ~ '^[A-Za-z0-9_]{1,16}$'),
  constraint newsletter_action_signing_key_times check (
    verify_until > created_at
    and (retired_at is null or retired_at >= created_at)
  )
);

create unique index newsletter_action_signing_keys_enabled_idx
  on gioia_private.newsletter_action_signing_keys ((issue_enabled))
  where issue_enabled;

create table gioia_private.newsletter_consent_cycles (
  id uuid primary key default extensions.gen_random_uuid(),
  subscriber_id uuid not null references gioia_private.newsletter_subscribers(id)
    on update restrict on delete restrict,
  subscriber_version integer not null,
  consent_at timestamptz not null,
  consent_source text not null,
  policy_version text not null,
  artifact_version text not null references gioia_private.newsletter_consent_artifacts(artifact_version)
    on update restrict on delete restrict,
  artifact_sha256 bytea not null,
  template_version smallint not null default 1,
  created_at timestamptz not null default statement_timestamp(),
  constraint newsletter_consent_cycles_subscriber_version_positive check (subscriber_version > 0),
  constraint newsletter_consent_cycles_source_bound check (length(btrim(consent_source)) between 1 and 100),
  constraint newsletter_consent_cycles_policy_bound check (length(btrim(policy_version)) between 1 and 100),
  constraint newsletter_consent_cycles_artifact_sha256 check (octet_length(artifact_sha256) = 32),
  constraint newsletter_consent_cycles_template_current check (template_version = 1),
  constraint newsletter_consent_cycles_evidence_time check (consent_at <= created_at),
  constraint newsletter_consent_cycles_subscriber_version_unique
    unique (subscriber_id, subscriber_version),
  constraint newsletter_consent_cycles_identity_unique
    unique (id, subscriber_id, subscriber_version)
);

create table gioia_private.newsletter_action_tokens (
  token_id uuid primary key,
  consent_cycle_id uuid not null,
  subscriber_id uuid not null,
  subscriber_version integer not null,
  issue_sequence integer not null default 1,
  token_version smallint not null default 1,
  purpose text not null,
  signing_key_id text not null references gioia_private.newsletter_action_signing_keys(key_id)
    on update restrict on delete restrict,
  issued_at timestamptz not null,
  expires_at timestamptz not null,
  consumed_at timestamptz,
  consumed_command_request_id uuid references gioia_private.command_requests(id)
    on update restrict on delete restrict,
  created_at timestamptz not null default statement_timestamp(),
  constraint newsletter_action_tokens_cycle_fk
    foreign key (consent_cycle_id, subscriber_id, subscriber_version)
    references gioia_private.newsletter_consent_cycles(id, subscriber_id, subscriber_version)
    on update restrict on delete restrict,
  constraint newsletter_action_tokens_subscriber_version_positive check (subscriber_version > 0),
  constraint newsletter_action_tokens_issue_sequence_positive check (issue_sequence > 0),
  constraint newsletter_action_tokens_version_current check (token_version = 1),
  constraint newsletter_action_tokens_purpose_known
    check (purpose in ('newsletter_confirm', 'newsletter_unsubscribe')),
  constraint newsletter_action_tokens_lifetime check (
    (purpose = 'newsletter_confirm' and expires_at = issued_at + interval '24 hours')
    or (purpose = 'newsletter_unsubscribe' and expires_at > issued_at
      and expires_at <= issued_at + interval '30 days')
  ),
  constraint newsletter_action_tokens_created_after_issue check (issued_at <= created_at),
  constraint newsletter_action_tokens_consumption_pair check (
    (consumed_at is null and consumed_command_request_id is null)
    or (consumed_at is not null and consumed_command_request_id is not null
      and consumed_at >= issued_at and consumed_at < expires_at)
  ),
  constraint newsletter_action_tokens_cycle_purpose_sequence_unique
    unique (consent_cycle_id, purpose, issue_sequence)
);

create unique index newsletter_action_tokens_confirmation_once_idx
  on gioia_private.newsletter_action_tokens (consent_cycle_id)
  where purpose = 'newsletter_confirm';
create index newsletter_action_tokens_expiry_idx
  on gioia_private.newsletter_action_tokens (expires_at, token_id)
  where consumed_at is null;

create table gioia_private.newsletter_consent_events (
  sequence_id bigint generated always as identity primary key,
  consent_cycle_id uuid not null references gioia_private.newsletter_consent_cycles(id)
    on update restrict on delete restrict,
  subscriber_id uuid not null references gioia_private.newsletter_subscribers(id)
    on update restrict on delete restrict,
  subscriber_version integer not null,
  event_kind text not null,
  action_token_id uuid references gioia_private.newsletter_action_tokens(token_id)
    on update restrict on delete restrict,
  command_request_id uuid not null references gioia_private.command_requests(id)
    on update restrict on delete restrict,
  occurred_at timestamptz not null default statement_timestamp(),
  constraint newsletter_consent_events_kind_known
    check (event_kind in ('requested', 'confirmed', 'withdrawn', 'superseded')),
  constraint newsletter_consent_events_version_positive check (subscriber_version > 0),
  constraint newsletter_consent_events_action_required check (
    (event_kind = 'requested' and action_token_id is null)
    or (event_kind in ('confirmed', 'withdrawn') and action_token_id is not null)
    or event_kind = 'superseded'
  )
);

alter table gioia_private.email_outbox
  add column template_version smallint not null default 1,
  add column newsletter_action_token_id uuid references gioia_private.newsletter_action_tokens(token_id)
    on update restrict on delete restrict,
  add column first_provider_attempt_at timestamptz,
  add column provider_retry_deadline_at timestamptz,
  add constraint email_outbox_template_version_current check (template_version = 1),
  add constraint email_outbox_provider_window_pair check (
    (first_provider_attempt_at is null and provider_retry_deadline_at is null)
    or (first_provider_attempt_at is not null
      and provider_retry_deadline_at = first_provider_attempt_at + interval '24 hours')
  );

create index email_outbox_provider_retry_deadline_idx
  on gioia_private.email_outbox (provider_retry_deadline_at, id)
  where status in ('sending', 'failed');

create table gioia_private.email_dead_letter_events (
  sequence_id bigint generated always as identity primary key,
  outbox_id uuid not null references gioia_private.email_outbox(id)
    on update restrict on delete restrict,
  outbox_version integer not null,
  reason_code text not null,
  origin text not null,
  occurred_at timestamptz not null default statement_timestamp(),
  constraint email_dead_letter_events_version_positive check (outbox_version > 0),
  constraint email_dead_letter_events_reason_format
    check (reason_code ~ '^[A-Z][A-Z0-9_]{1,63}$'),
  constraint email_dead_letter_events_origin_known
    check (origin in ('claim', 'completion', 'owner_retry', 'historical')),
  constraint email_dead_letter_events_outbox_version_unique unique (outbox_id, outbox_version)
);

commit;

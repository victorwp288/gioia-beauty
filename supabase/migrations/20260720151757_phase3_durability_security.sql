begin;

set local lock_timeout = '5s';
set local statement_timeout = '30s';

create table gioia_private.email_dead_letter_monitor_state (
  monitor_name text primary key,
  acked_sequence_id bigint not null default 0,
  batch_id uuid,
  locked_by text,
  leased_through_sequence_id bigint,
  lease_expires_at timestamptz,
  version integer not null default 1,
  created_at timestamptz not null default statement_timestamp(),
  updated_at timestamptz not null default statement_timestamp(),
  constraint email_dead_letter_monitor_singleton check (monitor_name = 'operator_alert_v1'),
  constraint email_dead_letter_monitor_ack_nonnegative check (acked_sequence_id >= 0),
  constraint email_dead_letter_monitor_lease_shape check (
    (batch_id is null and locked_by is null and leased_through_sequence_id is null and lease_expires_at is null)
    or (batch_id is not null and locked_by is not null
      and length(btrim(locked_by)) between 1 and 100
      and leased_through_sequence_id > acked_sequence_id and lease_expires_at is not null)
  ),
  constraint email_dead_letter_monitor_version_positive check (version > 0)
);

insert into gioia_private.email_dead_letter_monitor_state (monitor_name)
values ('operator_alert_v1');

create table gioia_private.public_abuse_policies (
  action text not null,
  scope_kind text not null,
  window_seconds integer not null,
  hard_limit integer not null,
  challenge_after integer,
  retention_seconds integer not null,
  primary key (action, scope_kind),
  constraint public_abuse_policies_action_known check (
    action in ('availability', 'booking', 'newsletter_subscribe', 'newsletter_action', 'owner_login')
  ),
  constraint public_abuse_policies_scope_known check (
    scope_kind in ('network', 'account', 'token')
  ),
  constraint public_abuse_policies_bounds check (
    window_seconds between 1 and 86400 and hard_limit between 1 and 10000
    and retention_seconds between window_seconds and 604800
    and (challenge_after is null or challenge_after between 1 and hard_limit)
  )
);

create table gioia_private.public_abuse_buckets (
  action text not null,
  scope_kind text not null,
  hmac_key_id text not null,
  scope_hash bytea not null,
  bucket_start timestamptz not null,
  bucket_end timestamptz not null,
  request_count integer not null,
  expires_at timestamptz not null,
  created_at timestamptz not null default statement_timestamp(),
  updated_at timestamptz not null default statement_timestamp(),
  primary key (action, scope_kind, hmac_key_id, scope_hash, bucket_start),
  constraint public_abuse_buckets_policy_fk foreign key (action, scope_kind)
    references gioia_private.public_abuse_policies(action, scope_kind)
    on update restrict on delete restrict,
  constraint public_abuse_buckets_key_id_format check (hmac_key_id ~ '^[A-Za-z0-9_]{1,16}$'),
  constraint public_abuse_buckets_hash_sha256 check (octet_length(scope_hash) = 32),
  constraint public_abuse_buckets_window_order check (
    bucket_end > bucket_start and expires_at >= bucket_end
  ),
  constraint public_abuse_buckets_count_positive check (request_count > 0)
);

create index public_abuse_buckets_expiry_idx
  on gioia_private.public_abuse_buckets (expires_at, bucket_start);

insert into gioia_private.public_abuse_policies (
  action, scope_kind, window_seconds, hard_limit, challenge_after, retention_seconds
) values
  ('availability', 'network', 60, 120, null, 3600),
  ('booking', 'network', 900, 10, 3, 86400),
  ('booking', 'account', 86400, 3, 1, 172800),
  ('newsletter_subscribe', 'network', 3600, 10, 5, 86400),
  ('newsletter_subscribe', 'account', 86400, 3, 1, 172800),
  ('newsletter_action', 'network', 900, 30, null, 86400),
  ('newsletter_action', 'token', 900, 10, null, 86400),
  ('owner_login', 'network', 900, 10, 5, 86400),
  ('owner_login', 'account', 900, 5, 3, 86400);

alter table gioia_private.newsletter_consent_artifacts enable row level security;
alter table gioia_private.newsletter_consent_artifacts force row level security;
alter table gioia_private.newsletter_action_signing_keys enable row level security;
alter table gioia_private.newsletter_action_signing_keys force row level security;
alter table gioia_private.newsletter_consent_cycles enable row level security;
alter table gioia_private.newsletter_consent_cycles force row level security;
alter table gioia_private.newsletter_action_tokens enable row level security;
alter table gioia_private.newsletter_action_tokens force row level security;
alter table gioia_private.newsletter_consent_events enable row level security;
alter table gioia_private.newsletter_consent_events force row level security;
alter table gioia_private.email_dead_letter_events enable row level security;
alter table gioia_private.email_dead_letter_events force row level security;
alter table gioia_private.email_dead_letter_monitor_state enable row level security;
alter table gioia_private.email_dead_letter_monitor_state force row level security;
alter table gioia_private.public_abuse_policies enable row level security;
alter table gioia_private.public_abuse_policies force row level security;
alter table gioia_private.public_abuse_buckets enable row level security;
alter table gioia_private.public_abuse_buckets force row level security;

create policy newsletter_consent_artifacts_mutator_select
  on gioia_private.newsletter_consent_artifacts for select to gioia_mutator using (true);
create policy newsletter_action_signing_keys_mutator_select
  on gioia_private.newsletter_action_signing_keys for select to gioia_mutator using (true);
create policy newsletter_consent_cycles_mutator_all
  on gioia_private.newsletter_consent_cycles for all to gioia_mutator using (true) with check (true);
create policy newsletter_action_tokens_mutator_all
  on gioia_private.newsletter_action_tokens for all to gioia_mutator using (true) with check (true);
create policy newsletter_consent_events_mutator_select
  on gioia_private.newsletter_consent_events for select to gioia_mutator using (true);
create policy newsletter_consent_events_mutator_insert
  on gioia_private.newsletter_consent_events for insert to gioia_mutator with check (true);
create policy email_dead_letter_events_mutator_select
  on gioia_private.email_dead_letter_events for select to gioia_mutator using (true);
create policy email_dead_letter_events_mutator_insert
  on gioia_private.email_dead_letter_events for insert to gioia_mutator with check (true);
create policy email_dead_letter_monitor_state_mutator_all
  on gioia_private.email_dead_letter_monitor_state for all to gioia_mutator using (true) with check (true);
create policy public_abuse_policies_mutator_select
  on gioia_private.public_abuse_policies for select to gioia_mutator using (true);
create policy public_abuse_buckets_mutator_all
  on gioia_private.public_abuse_buckets for all to gioia_mutator using (true) with check (true);

grant select on table
  gioia_private.newsletter_consent_artifacts,
  gioia_private.newsletter_action_signing_keys,
  gioia_private.public_abuse_policies
to gioia_mutator;
grant select, insert on table
  gioia_private.newsletter_consent_cycles,
  gioia_private.newsletter_consent_events,
  gioia_private.email_dead_letter_events
to gioia_mutator;
grant select, insert, update on table
  gioia_private.newsletter_action_tokens,
  gioia_private.email_dead_letter_monitor_state,
  gioia_private.public_abuse_buckets
to gioia_mutator;
grant delete on table gioia_private.public_abuse_buckets to gioia_mutator;
grant usage, select on all sequences in schema gioia_private to gioia_mutator;

insert into gioia_private.email_dead_letter_events (
  outbox_id, outbox_version, reason_code, origin, occurred_at
)
select outbox.id, outbox.version, outbox.last_error_code, 'historical', outbox.updated_at
from gioia_private.email_outbox as outbox
where outbox.status = 'dead_letter'
on conflict (outbox_id, outbox_version) do nothing;

commit;

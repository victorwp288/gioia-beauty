begin;

set local lock_timeout = '5s';
set local statement_timeout = '30s';

alter table gioia_private.newsletter_consent_artifacts
  add constraint newsletter_consent_artifacts_evidence_unique
    unique (artifact_version, policy_version, content_sha256);

alter table gioia_private.newsletter_consent_cycles
  add constraint newsletter_consent_cycles_artifact_evidence_fk
    foreign key (artifact_version, policy_version, artifact_sha256)
    references gioia_private.newsletter_consent_artifacts(
      artifact_version, policy_version, content_sha256
    ) on update restrict on delete restrict;

alter table gioia_private.newsletter_action_tokens
  add constraint newsletter_action_tokens_full_identity_unique
    unique (token_id, consent_cycle_id, subscriber_id, subscriber_version),
  add constraint newsletter_action_tokens_subscriber_identity_unique
    unique (token_id, subscriber_id, subscriber_version);

alter table gioia_private.newsletter_consent_events
  add constraint newsletter_consent_events_cycle_identity_fk
    foreign key (consent_cycle_id, subscriber_id, subscriber_version)
    references gioia_private.newsletter_consent_cycles(
      id, subscriber_id, subscriber_version
    ) on update restrict on delete restrict,
  add constraint newsletter_consent_events_action_identity_fk
    foreign key (
      action_token_id, consent_cycle_id, subscriber_id, subscriber_version
    ) references gioia_private.newsletter_action_tokens(
      token_id, consent_cycle_id, subscriber_id, subscriber_version
    ) on update restrict on delete restrict;

alter table gioia_private.email_outbox
  add constraint email_outbox_newsletter_action_identity_fk
    foreign key (newsletter_action_token_id, aggregate_id, aggregate_version)
    references gioia_private.newsletter_action_tokens(
      token_id, subscriber_id, subscriber_version
    ) on update restrict on delete restrict;

create index newsletter_consent_cycles_artifact_evidence_idx
  on gioia_private.newsletter_consent_cycles (
    artifact_version, policy_version, artifact_sha256
  );
create index newsletter_consent_events_cycle_identity_idx
  on gioia_private.newsletter_consent_events (
    consent_cycle_id, subscriber_id, subscriber_version
  );
create index newsletter_consent_events_action_identity_idx
  on gioia_private.newsletter_consent_events (
    action_token_id, consent_cycle_id, subscriber_id, subscriber_version
  ) where action_token_id is not null;
create index email_outbox_newsletter_action_identity_idx
  on gioia_private.email_outbox (
    newsletter_action_token_id, aggregate_id, aggregate_version
  ) where newsletter_action_token_id is not null;

create function gioia_private.enforce_newsletter_consent_cycle_binding()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if not exists (
    select 1
    from gioia_private.newsletter_subscribers as subscriber
    where subscriber.id = new.subscriber_id
      and subscriber.version = new.subscriber_version
      and subscriber.consent_at = new.consent_at
      and subscriber.consent_source = new.consent_source
      and subscriber.consent_policy_version = new.policy_version
  ) then
    raise exception using
      errcode = '23514',
      message = 'Consent cycle must match the current subscriber evidence';
  end if;
  return new;
end;
$$;

create trigger newsletter_consent_cycles_binding_guard
before insert on gioia_private.newsletter_consent_cycles
for each row execute function gioia_private.enforce_newsletter_consent_cycle_binding();

revoke all on function gioia_private.enforce_newsletter_consent_cycle_binding()
  from public, anon, authenticated, service_role, app_runtime, gioia_migrator;
grant execute on function gioia_private.enforce_newsletter_consent_cycle_binding()
  to gioia_mutator;

commit;

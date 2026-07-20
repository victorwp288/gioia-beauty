begin;

set local lock_timeout = '5s';
set local statement_timeout = '30s';

reset role;

revoke create on schema gioia_private from gioia_mutator;

revoke all on all tables in schema gioia_private
  from public, anon, authenticated, service_role, app_runtime;
revoke all on all sequences in schema gioia_private
  from public, anon, authenticated, service_role, app_runtime;

revoke all on function gioia_private.subscribe_public_newsletter(bytea,text,bytea,text)
  from public, anon, authenticated, service_role, app_runtime, gioia_migrator;
revoke all on function gioia_private.confirm_public_newsletter(
  uuid,integer,uuid,integer,timestamptz,timestamptz,text,bytea,text,bytea
) from public, anon, authenticated, service_role, app_runtime, gioia_migrator;
revoke all on function gioia_private.unsubscribe_public_newsletter(
  uuid,integer,uuid,integer,timestamptz,timestamptz,text,bytea,text,bytea
) from public, anon, authenticated, service_role, app_runtime, gioia_migrator;
revoke all on function gioia_private.claim_email_outbox(text,smallint,smallint)
  from public, anon, authenticated, service_role, app_runtime, gioia_migrator;
revoke all on function gioia_private.begin_email_outbox_provider_attempt(uuid,integer,text)
  from public, anon, authenticated, service_role, app_runtime, gioia_migrator;
revoke all on function gioia_private.claim_email_dead_letter_alert_batch(text,smallint,smallint)
  from public, anon, authenticated, service_role, app_runtime, gioia_migrator;
revoke all on function gioia_private.ack_email_dead_letter_alert_batch(text,uuid,bigint)
  from public, anon, authenticated, service_role, app_runtime, gioia_migrator;
revoke all on function gioia_private.consume_public_abuse_bucket(text,text,text,bytea,boolean)
  from public, anon, authenticated, service_role, app_runtime, gioia_migrator;
revoke all on function gioia_private.purge_expired_public_abuse_buckets(integer)
  from public, anon, authenticated, service_role, app_runtime, gioia_migrator;

grant execute on function gioia_private.subscribe_public_newsletter(bytea,text,bytea,text)
  to app_runtime;
grant execute on function gioia_private.confirm_public_newsletter(
  uuid,integer,uuid,integer,timestamptz,timestamptz,text,bytea,text,bytea
) to app_runtime;
grant execute on function gioia_private.unsubscribe_public_newsletter(
  uuid,integer,uuid,integer,timestamptz,timestamptz,text,bytea,text,bytea
) to app_runtime;
grant execute on function gioia_private.claim_email_outbox(text,smallint,smallint)
  to app_runtime;
grant execute on function gioia_private.begin_email_outbox_provider_attempt(uuid,integer,text)
  to app_runtime;
grant execute on function gioia_private.claim_email_dead_letter_alert_batch(text,smallint,smallint)
  to app_runtime;
grant execute on function gioia_private.ack_email_dead_letter_alert_batch(text,uuid,bigint)
  to app_runtime;
grant execute on function gioia_private.consume_public_abuse_bucket(text,text,text,bytea,boolean)
  to app_runtime;
grant execute on function gioia_private.purge_expired_public_abuse_buckets(integer)
  to app_runtime;

revoke all on function gioia_private.enforce_newsletter_action_token_transition()
  from public, anon, authenticated, service_role, app_runtime, gioia_migrator;
revoke all on function gioia_private.record_email_dead_letter_event()
  from public, anon, authenticated, service_role, app_runtime, gioia_migrator;
grant execute on function gioia_private.enforce_newsletter_action_token_transition()
  to gioia_mutator;
grant execute on function gioia_private.record_email_dead_letter_event()
  to gioia_mutator;

revoke gioia_mutator from postgres;

commit;

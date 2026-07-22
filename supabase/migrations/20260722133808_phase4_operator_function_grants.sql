begin;

set local lock_timeout = '5s';
set local statement_timeout = '30s';

grant gioia_mutator to postgres;
set local role gioia_mutator;

revoke all on function gioia_private.begin_cutover_write_freeze(text)
  from public, anon, authenticated, service_role, app_runtime, gioia_migrator;
revoke all on function gioia_private.begin_cutover_canary_run(uuid,text,timestamptz)
  from public, anon, authenticated, service_role, app_runtime, gioia_migrator;
revoke all on function gioia_private.issue_cutover_canary_grant(
  uuid,bytea,text,text,bytea,timestamptz
) from public, anon, authenticated, service_role, app_runtime, gioia_migrator;
revoke all on function gioia_private.revoke_cutover_canary_grant(uuid)
  from public, anon, authenticated, service_role, app_runtime, gioia_migrator;
revoke all on function gioia_private.reconcile_cutover_canary_run(uuid)
  from public, anon, authenticated, service_role, app_runtime, gioia_migrator;
revoke all on function gioia_private.enter_cutover_owner_reconcile(uuid,integer,text)
  from public, anon, authenticated, service_role, app_runtime, gioia_migrator;
revoke all on function gioia_private.complete_cutover_unfreeze(uuid,integer,text)
  from public, anon, authenticated, service_role, app_runtime, gioia_migrator;

grant execute on function gioia_private.begin_cutover_write_freeze(text)
  to postgres;
grant execute on function gioia_private.begin_cutover_canary_run(uuid,text,timestamptz)
  to postgres;
grant execute on function gioia_private.issue_cutover_canary_grant(
  uuid,bytea,text,text,bytea,timestamptz
) to postgres;
grant execute on function gioia_private.revoke_cutover_canary_grant(uuid)
  to postgres;
grant execute on function gioia_private.reconcile_cutover_canary_run(uuid)
  to postgres;
grant execute on function gioia_private.enter_cutover_owner_reconcile(uuid,integer,text)
  to postgres;
grant execute on function gioia_private.complete_cutover_unfreeze(uuid,integer,text)
  to postgres;

reset role;
revoke gioia_mutator from postgres;

commit;

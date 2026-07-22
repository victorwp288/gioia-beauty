begin;
select plan(2);

select ok(
  not exists (
    select 1
    from unnest(array[
      'gioia_private.begin_cutover_write_freeze(text)',
      'gioia_private.begin_cutover_canary_run(uuid,text,timestamptz)',
      'gioia_private.issue_cutover_canary_grant(uuid,bytea,text,text,bytea,timestamptz)',
      'gioia_private.revoke_cutover_canary_grant(uuid)',
      'gioia_private.reconcile_cutover_canary_run(uuid)',
      'gioia_private.enter_cutover_owner_reconcile(uuid,integer,text)',
      'gioia_private.complete_cutover_unfreeze(uuid,integer,text)'
    ]) as lifecycle(signature)
    where not has_function_privilege('postgres', lifecycle.signature, 'EXECUTE')
  ),
  'the hosted postgres operator can execute every cutover lifecycle function'
);

select ok(
  not exists (
    select 1
    from unnest(array[
      'public', 'anon', 'authenticated', 'service_role',
      'app_runtime', 'gioia_migrator'
    ]) as unsafe_role(role_name)
    cross join unnest(array[
      'gioia_private.begin_cutover_write_freeze(text)',
      'gioia_private.begin_cutover_canary_run(uuid,text,timestamptz)',
      'gioia_private.issue_cutover_canary_grant(uuid,bytea,text,text,bytea,timestamptz)',
      'gioia_private.revoke_cutover_canary_grant(uuid)',
      'gioia_private.reconcile_cutover_canary_run(uuid)',
      'gioia_private.enter_cutover_owner_reconcile(uuid,integer,text)',
      'gioia_private.complete_cutover_unfreeze(uuid,integer,text)'
    ]) as lifecycle(signature)
    where has_function_privilege(
      unsafe_role.role_name,
      lifecycle.signature,
      'EXECUTE'
    )
  ),
  'public and application roles cannot execute cutover lifecycle functions'
);

select * from finish();
rollback;

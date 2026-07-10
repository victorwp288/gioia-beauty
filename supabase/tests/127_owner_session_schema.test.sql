begin;

set local search_path = extensions, public, pg_catalog;

select plan(8);

select results_eq(
  $$select attribute.attname::text, pg_catalog.format_type(
      attribute.atttypid, attribute.atttypmod), attribute.attnotnull
    from pg_catalog.pg_attribute as attribute
    where attribute.attrelid = 'gioia_private.owner_sessions'::regclass
      and attribute.attnum > 0 and not attribute.attisdropped
    order by attribute.attnum$$,
  $$values
    ('session_id'::text,'uuid'::text,true),
    ('user_id'::text,'uuid'::text,true),
    ('created_at'::text,'timestamp with time zone'::text,true),
    ('expires_at'::text,'timestamp with time zone'::text,true),
    ('revoked_at'::text,'timestamp with time zone'::text,false)$$,
  'owner session ledger has only the reviewed non-PII columns'
);

select results_eq(
  $$select constraint_data.conname::text
    from pg_catalog.pg_constraint as constraint_data
    where constraint_data.conrelid = 'gioia_private.owner_sessions'::regclass
    order by constraint_data.conname$$,
  $$values
    ('owner_sessions_expiry_after_creation'::text),
    ('owner_sessions_lifetime_bounded'::text),
    ('owner_sessions_pkey'::text),
    ('owner_sessions_revocation_after_creation'::text),
    ('owner_sessions_user_id_fkey'::text)$$,
  'owner session ledger has exact identity, lifetime, and chronology constraints'
);

select ok(
  (
    select relation.relrowsecurity and relation.relforcerowsecurity
    from pg_catalog.pg_class as relation
    where relation.oid = 'gioia_private.owner_sessions'::regclass
  ) and not exists (
    select 1 from (values
      ('app_runtime'),('anon'),('authenticated'),('service_role'),('gioia_migrator')
    ) as role(role_name)
    where has_table_privilege(role.role_name,'gioia_private.owner_sessions','SELECT')
      or has_table_privilege(role.role_name,'gioia_private.owner_sessions','INSERT')
      or has_table_privilege(role.role_name,'gioia_private.owner_sessions','UPDATE')
      or has_table_privilege(role.role_name,'gioia_private.owner_sessions','DELETE')
  ),
  'owner sessions are forced-RLS with no direct caller table privileges'
);

select results_eq(
  $$select index_relation.relname::text
    from pg_catalog.pg_index as index_data
    join pg_catalog.pg_class as index_relation
      on index_relation.oid = index_data.indexrelid
    where index_data.indrelid = 'gioia_private.owner_sessions'::regclass
    order by index_relation.relname$$,
  $$values
    ('owner_sessions_active_expiry_idx'::text),
    ('owner_sessions_pkey'::text),
    ('owner_sessions_user_id_idx'::text)$$,
  'owner session lookups, FK checks, and bounded expiry scans are indexed'
);

select is(
  (select count(*) from unnest(array[
    to_regprocedure('gioia_private.authenticated_owner_session_id(uuid)'),
    to_regprocedure('gioia_private.assert_enabled_owner_account(uuid)'),
    to_regprocedure('gioia_private.assert_enabled_owner(uuid)'),
    to_regprocedure('gioia_private.start_owner_session(uuid,uuid)'),
    to_regprocedure('gioia_private.authorize_owner_session(uuid,uuid)'),
    to_regprocedure('gioia_private.revoke_owner_session(uuid,uuid)')
  ]) as signature(oid) where oid is not null),
  6::bigint,
  'all reviewed owner session functions exist at exact signatures'
);

select ok(
  not exists (
    select 1
    from pg_catalog.pg_proc as procedure
    join pg_catalog.pg_roles as owner on owner.oid = procedure.proowner
    cross join (values ('start_owner_session'),('authorize_owner_session'),
      ('revoke_owner_session')) as expected(function_name)
    where procedure.oid = to_regprocedure(
      'gioia_private.' || expected.function_name || '(uuid,uuid)'
    ) and (
      owner.rolname <> 'gioia_mutator' or not procedure.prosecdef
      or not has_function_privilege('app_runtime',procedure.oid,'EXECUTE')
      or not exists (select 1 from unnest(procedure.proconfig) as setting
        where setting in ('search_path=','search_path=""'))
    )
  ),
  'session boundaries are mutator-owned, pinned definers for app_runtime only'
);

select ok(
  not exists (
    select 1
    from (values ('anon'),('authenticated'),('service_role'),('gioia_migrator'))
      as role(role_name)
    cross join (values ('start_owner_session'),('authorize_owner_session'),
      ('revoke_owner_session')) as boundary(function_name)
    where has_function_privilege(role.role_name,to_regprocedure(
      'gioia_private.' || boundary.function_name || '(uuid,uuid)'),'EXECUTE')
  ),
  'browser, API, and migration roles cannot execute session boundaries'
);

select ok(
  not exists (
    select 1 from (values
      ('authenticated_owner_session_id(uuid)'),
      ('assert_enabled_owner_account(uuid)'),('assert_enabled_owner(uuid)')
    ) as helper(signature)
    where has_function_privilege('app_runtime',to_regprocedure(
      'gioia_private.' || helper.signature),'EXECUTE')
  ),
  'session authorization helpers are not direct runtime entry points'
);

select * from finish();
rollback;

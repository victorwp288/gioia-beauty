begin;

set local search_path = extensions, public, pg_catalog;

select plan(6);

select is(
  (
    select count(*)
    from pg_catalog.pg_roles
    where rolname = 'app_runtime_login'
  ),
  1::bigint,
  'runtime login carrier exists exactly once'
);

select ok(
  exists (
    select 1
    from pg_catalog.pg_roles
    where rolname = 'app_runtime_login'
      and not rolcanlogin
      and not rolsuper
      and not rolcreatedb
      and not rolcreaterole
      and not rolinherit
      and not rolreplication
      and not rolbypassrls
      and rolconnlimit = -1
  ),
  'runtime login carrier has no login or elevated attributes'
);

select ok(
  exists (
    select 1
    from pg_catalog.pg_roles as role
    join pg_catalog.pg_authid as auth on auth.oid = role.oid
    where role.rolname = 'app_runtime_login'
      and role.rolvaliduntil = 'infinity'::timestamptz
      and auth.rolpassword is null
      and (
        select pg_catalog.array_agg(setting order by setting)
        from pg_catalog.unnest(coalesce(role.rolconfig, '{}')) as config(setting)
      ) = array['lock_timeout=3s', 'statement_timeout=10s']::text[]
  ),
  'runtime login carrier is inert with exact timeout defaults'
);

select ok(
  (
    select count(*)
    from pg_catalog.pg_auth_members as membership
    join pg_catalog.pg_roles as granted_role
      on granted_role.oid = membership.roleid
    join pg_catalog.pg_roles as member_role
      on member_role.oid = membership.member
    where granted_role.rolname = 'app_runtime_login'
      or member_role.rolname = 'app_runtime_login'
  ) between 1 and 2
    and exists (
      select 1
      from pg_catalog.pg_auth_members as membership
      join pg_catalog.pg_roles as granted_role
        on granted_role.oid = membership.roleid
      join pg_catalog.pg_roles as member_role
        on member_role.oid = membership.member
      join pg_catalog.pg_roles as grantor_role
        on grantor_role.oid = membership.grantor
      where granted_role.rolname = 'app_runtime'
        and member_role.rolname = 'app_runtime_login'
        and grantor_role.rolname = 'postgres'
        and not membership.admin_option
        and not membership.inherit_option
        and membership.set_option
    )
    and pg_catalog.pg_has_role(
      'app_runtime_login', 'app_runtime', 'SET'
    )
    and not pg_catalog.pg_has_role(
      'app_runtime_login', 'app_runtime', 'USAGE'
    )
    and not exists (
      select 1
      from pg_catalog.pg_auth_members as membership
      join pg_catalog.pg_roles as granted_role
        on granted_role.oid = membership.roleid
      join pg_catalog.pg_roles as member_role
        on member_role.oid = membership.member
      join pg_catalog.pg_roles as grantor_role
        on grantor_role.oid = membership.grantor
      where (
        granted_role.rolname = 'app_runtime_login'
        or member_role.rolname = 'app_runtime_login'
      )
        and not (
          granted_role.rolname = 'app_runtime_login'
          and member_role.rolname = 'postgres'
          and grantor_role.rolname = 'supabase_admin'
          and membership.admin_option
          and not membership.inherit_option
          and not membership.set_option
        )
        and not (
          granted_role.rolname = 'app_runtime'
          and member_role.rolname = 'app_runtime_login'
          and grantor_role.rolname = 'postgres'
          and not membership.admin_option
          and not membership.inherit_option
          and membership.set_option
        )
    ),
  'runtime login carrier has only its exact SET-only authorization path'
);

select ok(
  not exists (
    select 1
    from pg_catalog.pg_database as database
    cross join lateral pg_catalog.aclexplode(database.datacl) as access
    where access.grantee = 'app_runtime_login'::regrole
  )
    and not exists (
      select 1
      from pg_catalog.pg_namespace as namespace
      cross join lateral pg_catalog.aclexplode(namespace.nspacl) as access
      where access.grantee = 'app_runtime_login'::regrole
    )
    and not exists (
      select 1
      from pg_catalog.pg_class as relation
      cross join lateral pg_catalog.aclexplode(relation.relacl) as access
      where access.grantee = 'app_runtime_login'::regrole
    )
    and not exists (
      select 1
      from pg_catalog.pg_proc as procedure
      cross join lateral pg_catalog.aclexplode(procedure.proacl) as access
      where access.grantee = 'app_runtime_login'::regrole
    )
    and not exists (
      select 1
      from pg_catalog.pg_default_acl as defaults
      where defaults.defaclrole = 'app_runtime_login'::regrole
    )
    and not exists (
      select 1
      from pg_catalog.pg_type as type
      cross join lateral pg_catalog.aclexplode(type.typacl) as access
      where 'app_runtime_login'::regrole in (access.grantee, access.grantor)
    )
    and not exists (
      select 1
      from pg_catalog.pg_default_acl as defaults
      cross join lateral pg_catalog.aclexplode(defaults.defaclacl) as access
      where 'app_runtime_login'::regrole in (access.grantee, access.grantor)
    )
    and not exists (
      select 1
      from pg_catalog.pg_database as database
      where database.datdba = 'app_runtime_login'::regrole
    )
    and not exists (
      select 1
      from pg_catalog.pg_namespace as namespace
      where namespace.nspowner = 'app_runtime_login'::regrole
    )
    and not exists (
      select 1
      from pg_catalog.pg_class as relation
      where relation.relowner = 'app_runtime_login'::regrole
    )
    and not exists (
      select 1
      from pg_catalog.pg_proc as procedure
      where procedure.proowner = 'app_runtime_login'::regrole
    )
    and not exists (
      select 1
      from pg_catalog.pg_type as type
      where type.typowner = 'app_runtime_login'::regrole
    )
    and not exists (
      select 1
      from pg_catalog.pg_extension as extension
      where extension.extowner = 'app_runtime_login'::regrole
    ),
  'runtime login carrier owns nothing and has no direct object ACLs'
);

grant app_runtime_login to postgres
  with admin false, inherit false, set true
  granted by current_user;

-- The static SQL safety checker requires every SET LOCAL ROLE test to grant
-- the target role and pgTAP's extension schema explicitly. Both grants are
-- transaction-scoped and roll back with this test.
grant app_runtime to postgres
  with admin false, inherit false, set true
  granted by current_user;
grant usage on schema extensions to app_runtime;

set local role app_runtime_login;
select pg_catalog.set_config(
  'gioia.runtime_login_carrier_user', current_user, true
);
do $carrier_denied$
begin
  perform gioia_private.get_cutover_write_state();
  perform pg_catalog.set_config(
    'gioia.runtime_login_direct_call_denied', 'false', true
  );
exception
  when insufficient_privilege then
    perform pg_catalog.set_config(
      'gioia.runtime_login_direct_call_denied', 'true', true
    );
end
$carrier_denied$;
set local role app_runtime;
select pg_catalog.set_config(
  'gioia.runtime_authorization_user', current_user, true
);
do $authorization_allowed$
begin
  perform gioia_private.get_cutover_write_state();
  perform pg_catalog.set_config(
    'gioia.runtime_authorized_call_allowed', 'true', true
  );
exception
  when others then
    perform pg_catalog.set_config(
      'gioia.runtime_authorized_call_allowed', 'false', true
    );
end
$authorization_allowed$;
reset role;

select is(
  pg_catalog.current_setting('gioia.runtime_login_carrier_user') || '>' ||
    pg_catalog.current_setting('gioia.runtime_authorization_user') || '>' ||
    pg_catalog.current_setting('gioia.runtime_login_direct_call_denied') || '>' ||
    pg_catalog.current_setting('gioia.runtime_authorized_call_allowed'),
  'app_runtime_login>app_runtime>true>true',
  'carrier has no direct call access and SET ROLE enables authorization access'
);

select * from finish();

rollback;

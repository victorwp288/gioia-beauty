begin;

set local search_path = extensions, public, pg_catalog;

select plan(6);

select is(
  (
    select count(*)
    from pg_catalog.pg_roles
    where rolname = 'app_runtime'
  ),
  1::bigint,
  'direct runtime role exists exactly once'
);

select is(
  (
    select count(*)
    from pg_catalog.pg_roles
    where rolname = 'app_runtime_login'
  ),
  0::bigint,
  'runtime login carrier is absent'
);

select ok(
  exists (
    select 1
    from pg_catalog.pg_roles
    where rolname = 'app_runtime'
      and rolcanlogin
      and not rolsuper
      and not rolcreatedb
      and not rolcreaterole
      and not rolinherit
      and not rolreplication
      and not rolbypassrls
      and rolconnlimit = -1
  ),
  'direct runtime role has LOGIN and no elevated attributes'
);

select ok(
  exists (
    select 1
    from pg_catalog.pg_roles as role
    join pg_catalog.pg_authid as auth on auth.oid = role.oid
    where role.rolname = 'app_runtime'
      and role.rolvaliduntil = 'infinity'::timestamptz
      and (
        auth.rolpassword is null
        or auth.rolpassword like 'SCRAM-SHA-256$%'
      )
      and (
        select pg_catalog.array_agg(setting order by setting)
        from pg_catalog.unnest(coalesce(role.rolconfig, '{}')) as config(setting)
      ) = array['lock_timeout=3s', 'statement_timeout=10s']::text[]
  ),
  'runtime credential is absent or SCRAM and timeout defaults are exact'
);

select ok(
  (
    select count(*)
    from pg_catalog.pg_auth_members as membership
    join pg_catalog.pg_roles as granted_role
      on granted_role.oid = membership.roleid
    join pg_catalog.pg_roles as member_role
      on member_role.oid = membership.member
    where granted_role.rolname = 'app_runtime'
      or member_role.rolname = 'app_runtime'
  ) = 1 and exists (
    select 1
    from pg_catalog.pg_auth_members as membership
    join pg_catalog.pg_roles as granted_role
      on granted_role.oid = membership.roleid
    join pg_catalog.pg_roles as member_role
      on member_role.oid = membership.member
    join pg_catalog.pg_roles as grantor_role
      on grantor_role.oid = membership.grantor
    where granted_role.rolname = 'app_runtime'
      and member_role.rolname = 'postgres'
      and grantor_role.rolname = 'supabase_admin'
      and membership.admin_option
      and not membership.inherit_option
      and not membership.set_option
  ) and not exists (
    select 1
    from pg_catalog.pg_auth_members as membership
    join pg_catalog.pg_roles as granted_role
      on granted_role.oid = membership.roleid
    join pg_catalog.pg_roles as member_role
      on member_role.oid = membership.member
    join pg_catalog.pg_roles as grantor_role
      on grantor_role.oid = membership.grantor
    where (
      granted_role.rolname = 'app_runtime'
      or member_role.rolname = 'app_runtime'
    )
      and not (
        granted_role.rolname = 'app_runtime'
        and member_role.rolname = 'postgres'
        and grantor_role.rolname = 'supabase_admin'
        and membership.admin_option
        and not membership.inherit_option
        and not membership.set_option
      )
  ),
  'direct runtime role has only its provider creator-admin membership'
);

select ok(
  not exists (
    select 1 from pg_catalog.pg_database
      where datdba = 'app_runtime'::regrole
    union all
    select 1 from pg_catalog.pg_namespace
      where nspowner = 'app_runtime'::regrole
    union all
    select 1 from pg_catalog.pg_class
      where relowner = 'app_runtime'::regrole
    union all
    select 1 from pg_catalog.pg_proc
      where proowner = 'app_runtime'::regrole
    union all
    select 1 from pg_catalog.pg_type
      where typowner = 'app_runtime'::regrole
    union all
    select 1 from pg_catalog.pg_extension
      where extowner = 'app_runtime'::regrole
    union all
    select 1 from pg_catalog.pg_default_acl
      where defaclrole = 'app_runtime'::regrole
  ) and not exists (
    select 1
    from pg_catalog.pg_class as relation
    join pg_catalog.pg_namespace as namespace
      on namespace.oid = relation.relnamespace
    cross join lateral pg_catalog.aclexplode(relation.relacl) as access
    where namespace.nspname = 'gioia_private'
      and relation.relkind in ('r', 'p', 'S')
      and access.grantee = 'app_runtime'::regrole
  ) and has_schema_privilege('app_runtime', 'gioia_private', 'USAGE'),
  'direct runtime role owns nothing and retains function-only schema access'
);

select * from finish();

rollback;

begin;

set local lock_timeout = '5s';
set local statement_timeout = '30s';

do $$
begin
  if current_user <> 'postgres' then
    raise exception 'Migrations must run as the constrained postgres principal';
  end if;
end
$$;

do $$
begin
  if not exists (
    select 1 from pg_catalog.pg_roles where rolname = 'app_runtime'
  ) or not exists (
    select 1 from pg_catalog.pg_roles where rolname = 'app_runtime_login'
  ) then
    raise exception 'Runtime role simplification requires both reviewed roles';
  end if;

  if exists (
    select 1
    from pg_catalog.pg_roles
    where rolname in ('app_runtime', 'app_runtime_login')
      and (rolsuper or rolcreatedb or rolcreaterole or rolinherit
        or rolreplication or rolbypassrls or rolconnlimit <> -1)
  ) then
    raise exception 'Runtime roles have unsafe attributes';
  end if;

  if exists (
    select 1
    from pg_catalog.pg_stat_activity
    where pid <> pg_catalog.pg_backend_pid()
      and datname = pg_catalog.current_database()
      and (
        usename in ('app_runtime', 'app_runtime_login')
        or application_name = 'gioia_public_api'
      )
  ) then
    raise exception 'Runtime roles have active sessions';
  end if;

  if (
    select count(*)
    from pg_catalog.pg_auth_members as membership
    join pg_catalog.pg_roles as granted_role
      on granted_role.oid = membership.roleid
    join pg_catalog.pg_roles as member_role
      on member_role.oid = membership.member
    where granted_role.rolname = 'app_runtime_login'
      or member_role.rolname = 'app_runtime_login'
  ) not between 1 and 2 or not exists (
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
      and grantor_role.rolname = current_user
      and not membership.admin_option
      and not membership.inherit_option
      and membership.set_option
  ) or exists (
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
        and grantor_role.rolname = current_user
        and not membership.admin_option
        and not membership.inherit_option
        and membership.set_option
      )
  ) then
    raise exception 'Runtime login carrier membership is not exact';
  end if;

  if exists (
    select 1 from pg_catalog.pg_database
      where datdba = 'app_runtime_login'::regrole
    union all
    select 1 from pg_catalog.pg_namespace
      where nspowner = 'app_runtime_login'::regrole
    union all
    select 1 from pg_catalog.pg_class
      where relowner = 'app_runtime_login'::regrole
    union all
    select 1 from pg_catalog.pg_proc
      where proowner = 'app_runtime_login'::regrole
    union all
    select 1 from pg_catalog.pg_type
      where typowner = 'app_runtime_login'::regrole
    union all
    select 1 from pg_catalog.pg_extension
      where extowner = 'app_runtime_login'::regrole
    union all
    select 1 from pg_catalog.pg_default_acl
      where defaclrole = 'app_runtime_login'::regrole
  ) or exists (
    select 1 from pg_catalog.pg_database as object
      cross join lateral pg_catalog.aclexplode(object.datacl) as access
      where 'app_runtime_login'::regrole in (access.grantee, access.grantor)
    union all
    select 1 from pg_catalog.pg_namespace as object
      cross join lateral pg_catalog.aclexplode(object.nspacl) as access
      where 'app_runtime_login'::regrole in (access.grantee, access.grantor)
    union all
    select 1 from pg_catalog.pg_class as object
      cross join lateral pg_catalog.aclexplode(object.relacl) as access
      where 'app_runtime_login'::regrole in (access.grantee, access.grantor)
    union all
    select 1 from pg_catalog.pg_proc as object
      cross join lateral pg_catalog.aclexplode(object.proacl) as access
      where 'app_runtime_login'::regrole in (access.grantee, access.grantor)
    union all
    select 1 from pg_catalog.pg_type as object
      cross join lateral pg_catalog.aclexplode(object.typacl) as access
      where 'app_runtime_login'::regrole in (access.grantee, access.grantor)
    union all
    select 1 from pg_catalog.pg_default_acl as object
      cross join lateral pg_catalog.aclexplode(object.defaclacl) as access
      where 'app_runtime_login'::regrole in (access.grantee, access.grantor)
  ) then
    raise exception 'Runtime login carrier has ownership or ACL residue';
  end if;
end
$$;

revoke app_runtime from app_runtime_login granted by current_user;
drop role app_runtime_login;

-- The durable application principal owns no object and receives no table or
-- sequence ACL. This migration never reads, clears, or replaces its password;
-- protected remote configuration owns credential installation and rotation.
alter role app_runtime
  login
  valid until 'infinity'
  nocreatedb
  nocreaterole
  noinherit
  connection limit -1;
alter role app_runtime set statement_timeout = '10s';
alter role app_runtime set lock_timeout = '3s';

do $$
begin
  if not exists (
    select 1
    from pg_catalog.pg_roles as role
    where role.rolname = 'app_runtime'
      and role.rolcanlogin
      and not role.rolsuper
      and not role.rolcreatedb
      and not role.rolcreaterole
      and not role.rolinherit
      and not role.rolreplication
      and not role.rolbypassrls
      and role.rolconnlimit = -1
      and role.rolvaliduntil = 'infinity'::timestamptz
      and (
        select pg_catalog.array_agg(setting order by setting)
        from pg_catalog.unnest(coalesce(role.rolconfig, '{}')) as config(setting)
      ) = array['lock_timeout=3s', 'statement_timeout=10s']::text[]
  ) then
    raise exception 'Direct runtime role is not exact';
  end if;

  if (
    select count(*)
    from pg_catalog.pg_auth_members as membership
    join pg_catalog.pg_roles as granted_role
      on granted_role.oid = membership.roleid
    join pg_catalog.pg_roles as member_role
      on member_role.oid = membership.member
    where granted_role.rolname = 'app_runtime'
      or member_role.rolname = 'app_runtime'
  ) <> 1 or not exists (
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
  ) or exists (
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
  ) or exists (
    select 1
    from pg_catalog.pg_authid
    where rolname = 'app_runtime'
      and rolpassword is not null
      and rolpassword not like 'SCRAM-SHA-256$%'
  ) or exists (
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
  ) or exists (
    select 1
    from pg_catalog.pg_class as relation
    join pg_catalog.pg_namespace as namespace
      on namespace.oid = relation.relnamespace
    cross join lateral pg_catalog.aclexplode(relation.relacl) as access
    where namespace.nspname = 'gioia_private'
      and relation.relkind in ('r', 'p', 'S')
      and access.grantee = 'app_runtime'::regrole
  ) then
    raise exception 'Direct runtime role has unsafe access or membership';
  end if;
end
$$;

commit;

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
    select 1
    from pg_catalog.pg_roles
    where rolname = 'app_runtime_login'
  ) then
    create role app_runtime_login
      nologin
      nosuperuser
      nocreatedb
      nocreaterole
      noinherit
      noreplication
      nobypassrls;
  end if;
end
$$;

do $$
begin
  if exists (
    select 1
    from pg_catalog.pg_roles
    where rolname = 'app_runtime_login'
      and (rolsuper or rolreplication or rolbypassrls)
  ) then
    raise exception 'Runtime login carrier must not have elevated attributes';
  end if;
end
$$;

-- Keep the committed carrier inert. The guarded TEST/Preview lifecycle is the
-- only path that may install a short-lived credential and enable LOGIN.
alter role app_runtime_login
  nologin
  password null
  valid until 'infinity'
  nocreatedb
  nocreaterole
  noinherit
  connection limit -1;
alter role app_runtime_login set statement_timeout = '10s';
alter role app_runtime_login set lock_timeout = '3s';

grant app_runtime to app_runtime_login
  with admin false, inherit false, set true
  granted by current_user;

do $$
begin
  if (
    select count(*)
    from pg_catalog.pg_auth_members as membership
    join pg_catalog.pg_roles as granted_role
      on granted_role.oid = membership.roleid
    join pg_catalog.pg_roles as member_role
      on member_role.oid = membership.member
    join pg_catalog.pg_roles as grantor_role
      on grantor_role.oid = membership.grantor
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
    raise exception 'Runtime login carrier membership must be exact';
  end if;
end
$$;

do $$
begin
  if exists (
    select 1 from pg_catalog.pg_database as database
      where database.datdba = 'app_runtime_login'::regrole
    union all
    select 1 from pg_catalog.pg_namespace as namespace
      where namespace.nspowner = 'app_runtime_login'::regrole
    union all
    select 1 from pg_catalog.pg_class as relation
      where relation.relowner = 'app_runtime_login'::regrole
    union all
    select 1 from pg_catalog.pg_proc as procedure
      where procedure.proowner = 'app_runtime_login'::regrole
    union all
    select 1 from pg_catalog.pg_type as type
      where type.typowner = 'app_runtime_login'::regrole
    union all
    select 1 from pg_catalog.pg_extension as extension
      where extension.extowner = 'app_runtime_login'::regrole
    union all
    select 1 from pg_catalog.pg_default_acl as defaults
      where defaults.defaclrole = 'app_runtime_login'::regrole
  ) or exists (
    select 1 from pg_catalog.pg_database as database
      cross join lateral pg_catalog.aclexplode(database.datacl) as access
      where 'app_runtime_login'::regrole in (access.grantee, access.grantor)
    union all
    select 1 from pg_catalog.pg_namespace as namespace
      cross join lateral pg_catalog.aclexplode(namespace.nspacl) as access
      where 'app_runtime_login'::regrole in (access.grantee, access.grantor)
    union all
    select 1 from pg_catalog.pg_class as relation
      cross join lateral pg_catalog.aclexplode(relation.relacl) as access
      where 'app_runtime_login'::regrole in (access.grantee, access.grantor)
    union all
    select 1 from pg_catalog.pg_proc as procedure
      cross join lateral pg_catalog.aclexplode(procedure.proacl) as access
      where 'app_runtime_login'::regrole in (access.grantee, access.grantor)
    union all
    select 1 from pg_catalog.pg_type as type
      cross join lateral pg_catalog.aclexplode(type.typacl) as access
      where 'app_runtime_login'::regrole in (access.grantee, access.grantor)
    union all
    select 1 from pg_catalog.pg_default_acl as defaults
      cross join lateral pg_catalog.aclexplode(defaults.defaclacl) as access
      where 'app_runtime_login'::regrole in (access.grantee, access.grantor)
  ) then
    raise exception 'Runtime login carrier must not own objects or have ACL residue';
  end if;
end
$$;

commit;

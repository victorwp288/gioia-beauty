export const RUNTIME_PASSWORD_CONFIG_SQL =
  "select set_config('gioia.test_runtime_password', $1, true)";
export const RUNTIME_ROLE_GRANT_SQL =
  "grant app_runtime to postgres with inherit false, set true granted by current_user";
export const RUNTIME_ROLE_ALTER_SQL = `
  do $role$
  begin
    execute pg_catalog.format(
      'alter role app_runtime_login login password %L valid until %L',
      pg_catalog.current_setting('gioia.test_runtime_password'),
      pg_catalog.clock_timestamp() + interval '15 minutes'
    );
  end
  $role$
`;
export const RUNTIME_ROLE_DISABLE_SQL =
  "alter role app_runtime_login nologin password null valid until 'infinity'";
export const RUNTIME_ROLE_REVOKE_SQL =
  "revoke app_runtime from postgres granted by current_user";
export const RUNTIME_SESSION_TERMINATE_SQL = `
  select pg_catalog.pg_terminate_backend(pid) as terminated
  from pg_catalog.pg_stat_activity
  where pid <> pg_catalog.pg_backend_pid()
    and datname = pg_catalog.current_database()
    and (usename = 'app_runtime_login' or application_name = 'gioia_public_api')
`;
export const RUNTIME_SESSION_STATE_SQL = `
  select count(*)::integer as active
  from pg_catalog.pg_stat_activity
  where pid <> pg_catalog.pg_backend_pid()
    and datname = pg_catalog.current_database()
    and (usename = 'app_runtime_login' or application_name = 'gioia_public_api')
`;
export const RUNTIME_ROLE_STATE_SQL = `
  select login_role.rolcanlogin,
    not login_role.rolsuper and not login_role.rolinherit and
      not login_role.rolcreaterole and not login_role.rolcreatedb and
      not login_role.rolreplication and not login_role.rolbypassrls and
      login_role.rolconnlimit = -1 and
      (login_role.rolvaliduntil is null or
        login_role.rolvaliduntil = 'infinity'::timestamptz) and
      (select pg_catalog.array_agg(setting order by setting)
        from pg_catalog.unnest(coalesce(login_role.rolconfig, '{}')) as config(setting))
        = array['lock_timeout=3s','statement_timeout=10s']::text[] and
      not authorization_role.rolcanlogin and not authorization_role.rolsuper and
      not authorization_role.rolinherit and not authorization_role.rolcreaterole and
      not authorization_role.rolcreatedb and not authorization_role.rolreplication and
      not authorization_role.rolbypassrls and authorization_role.rolconnlimit = -1 and
      (authorization_role.rolvaliduntil is null or
        authorization_role.rolvaliduntil = 'infinity'::timestamptz) and
      (select pg_catalog.array_agg(setting order by setting)
        from pg_catalog.unnest(coalesce(authorization_role.rolconfig, '{}')) as config(setting))
        = array['lock_timeout=3s','statement_timeout=10s']::text[]
      as attributes_are_safe,
    (
      select case
        when login_role.rolcanlogin then
          login_auth.rolpassword like 'SCRAM-SHA-256$%'
          and login_role.rolvaliduntil = 'infinity'::timestamptz
        else login_auth.rolpassword is null
      end
        and authorization_auth.rolpassword is null
      from pg_catalog.pg_authid login_auth
      cross join pg_catalog.pg_authid authorization_auth
      where login_auth.oid = login_role.oid
        and authorization_auth.oid = authorization_role.oid
    ) as credential_is_safe,
    (select count(*)
      from pg_catalog.pg_auth_members membership
      where membership.roleid in (authorization_role.oid, login_role.oid)
        or membership.member in (authorization_role.oid, login_role.oid)) <> 3 or
    not exists (
      select 1
      from pg_catalog.pg_auth_members membership
      where membership.roleid = authorization_role.oid
        and membership.member = operator_role.oid
        and membership.grantor = creator_role.oid
        and membership.admin_option
        and not membership.inherit_option
        and not membership.set_option
    ) or not exists (
      select 1
      from pg_catalog.pg_auth_members membership
      where membership.roleid = login_role.oid
        and membership.member = operator_role.oid
        and membership.grantor = creator_role.oid
        and membership.admin_option
        and not membership.inherit_option
        and not membership.set_option
    ) or not exists (
      select 1
      from pg_catalog.pg_auth_members membership
      where membership.roleid = authorization_role.oid
        and membership.member = login_role.oid
        and membership.grantor = operator_role.oid
        and not membership.admin_option
        and not membership.inherit_option
        and membership.set_option
    ) as has_unsafe_membership,
    exists (
      select 1 from pg_catalog.pg_database as database_object
        where database_object.datdba = login_role.oid
      union all
      select 1 from pg_catalog.pg_namespace as namespace_object
        where namespace_object.nspowner = login_role.oid
      union all
      select 1 from pg_catalog.pg_class as relation_object
        where relation_object.relowner = login_role.oid
      union all
      select 1 from pg_catalog.pg_proc as procedure_object
        where procedure_object.proowner = login_role.oid
      union all
      select 1 from pg_catalog.pg_type as type_object
        where type_object.typowner = login_role.oid
      union all
      select 1 from pg_catalog.pg_extension as extension_object
        where extension_object.extowner = login_role.oid
      union all
      select 1 from pg_catalog.pg_default_acl as default_acl
        where default_acl.defaclrole = login_role.oid
    ) or exists (
      select 1 from pg_catalog.pg_database as database_object
        cross join lateral pg_catalog.aclexplode(database_object.datacl) as access
        where login_role.oid in (access.grantee, access.grantor)
      union all
      select 1 from pg_catalog.pg_namespace as namespace_object
        cross join lateral pg_catalog.aclexplode(namespace_object.nspacl) as access
        where login_role.oid in (access.grantee, access.grantor)
      union all
      select 1 from pg_catalog.pg_class as relation_object
        cross join lateral pg_catalog.aclexplode(relation_object.relacl) as access
        where login_role.oid in (access.grantee, access.grantor)
      union all
      select 1 from pg_catalog.pg_proc as procedure_object
        cross join lateral pg_catalog.aclexplode(procedure_object.proacl) as access
        where login_role.oid in (access.grantee, access.grantor)
      union all
      select 1 from pg_catalog.pg_type as type_object
        cross join lateral pg_catalog.aclexplode(type_object.typacl) as access
        where login_role.oid in (access.grantee, access.grantor)
      union all
      select 1 from pg_catalog.pg_default_acl as default_acl
        cross join lateral pg_catalog.aclexplode(default_acl.defaclacl) as access
        where login_role.oid in (access.grantee, access.grantor)
    ) as has_unsafe_access
  from pg_catalog.pg_roles login_role
  cross join pg_catalog.pg_roles authorization_role
  cross join pg_catalog.pg_roles operator_role
  cross join pg_catalog.pg_roles creator_role
  where login_role.rolname = 'app_runtime_login'
    and authorization_role.rolname = 'app_runtime'
    and operator_role.rolname = 'postgres'
    and creator_role.rolname = 'supabase_admin'
`;
export const PREVIEW_ROLE_RESTORE_SQL = `
  do $role$
  begin
    execute pg_catalog.format(
      'alter role app_runtime_login login password %L valid until %L',
      pg_catalog.current_setting('gioia.test_runtime_password'),
      'infinity'
    );
  end
  $role$
`;
export const PREVIEW_ROLE_AUTHENTICATE_SQL = `
  select session_user = 'app_runtime_login' and
    current_user = 'app_runtime_login'
    as authorized
`;
export const PREVIEW_ROLE_ASSUME_SQL = "set local role app_runtime";
export const PREVIEW_ROLE_AUTHORIZE_SQL = `
  select session_user = 'app_runtime_login' and
    current_user = 'app_runtime' and
    (select count(*) = 1 from gioia_private.get_cutover_write_state())
    as authorized
`;

export const GREENFIELD_RUNTIME_ROLE_SQL = Object.freeze({
  setup: Object.freeze([
    RUNTIME_PASSWORD_CONFIG_SQL,
    RUNTIME_ROLE_GRANT_SQL,
    RUNTIME_ROLE_ALTER_SQL,
  ]),
  cleanup: Object.freeze([RUNTIME_ROLE_DISABLE_SQL, RUNTIME_ROLE_REVOKE_SQL]),
  sessions: Object.freeze([
    RUNTIME_SESSION_TERMINATE_SQL,
    RUNTIME_SESSION_STATE_SQL,
  ]),
  state: RUNTIME_ROLE_STATE_SQL,
});
export const GREENFIELD_PREVIEW_ROLE_SQL = Object.freeze({
  authenticate: PREVIEW_ROLE_AUTHENTICATE_SQL,
  assume: PREVIEW_ROLE_ASSUME_SQL,
  authorize: PREVIEW_ROLE_AUTHORIZE_SQL,
  restore: Object.freeze([
    RUNTIME_PASSWORD_CONFIG_SQL,
    PREVIEW_ROLE_RESTORE_SQL,
  ]),
});

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
  select login.rolcanlogin,
    not login.rolsuper and not login.rolinherit and not login.rolcreaterole and
      not login.rolcreatedb and not login.rolreplication and not login.rolbypassrls and
      login.rolconnlimit = -1 and
      (login.rolvaliduntil is null or login.rolvaliduntil = 'infinity'::timestamptz) and
      (select pg_catalog.array_agg(setting order by setting)
        from pg_catalog.unnest(coalesce(login.rolconfig, '{}')) as config(setting))
        = array['lock_timeout=3s','statement_timeout=10s']::text[] and
      not authorization.rolcanlogin and not authorization.rolsuper and
      not authorization.rolinherit and not authorization.rolcreaterole and
      not authorization.rolcreatedb and not authorization.rolreplication and
      not authorization.rolbypassrls and authorization.rolconnlimit = -1 and
      (authorization.rolvaliduntil is null or
        authorization.rolvaliduntil = 'infinity'::timestamptz) and
      (select pg_catalog.array_agg(setting order by setting)
        from pg_catalog.unnest(coalesce(authorization.rolconfig, '{}')) as config(setting))
        = array['lock_timeout=3s','statement_timeout=10s']::text[]
      as attributes_are_safe,
    (
      select case
        when login.rolcanlogin then
          login_auth.rolpassword like 'SCRAM-SHA-256$%'
          and login.rolvaliduntil = 'infinity'::timestamptz
        else login_auth.rolpassword is null
      end
        and authorization_auth.rolpassword is null
      from pg_catalog.pg_authid login_auth
      cross join pg_catalog.pg_authid authorization_auth
      where login_auth.oid = login.oid
        and authorization_auth.oid = authorization.oid
    ) as credential_is_safe,
    (select count(*)
      from pg_catalog.pg_auth_members membership
      where membership.roleid in (authorization.oid, login.oid)
        or membership.member in (authorization.oid, login.oid)) <> 3 or
    not exists (
      select 1
      from pg_catalog.pg_auth_members membership
      where membership.roleid = authorization.oid
        and membership.member = operator.oid
        and membership.grantor = creator.oid
        and membership.admin_option
        and not membership.inherit_option
        and not membership.set_option
    ) or not exists (
      select 1
      from pg_catalog.pg_auth_members membership
      where membership.roleid = login.oid
        and membership.member = operator.oid
        and membership.grantor = creator.oid
        and membership.admin_option
        and not membership.inherit_option
        and not membership.set_option
    ) or not exists (
      select 1
      from pg_catalog.pg_auth_members membership
      where membership.roleid = authorization.oid
        and membership.member = login.oid
        and membership.grantor = operator.oid
        and not membership.admin_option
        and not membership.inherit_option
        and membership.set_option
    ) as has_unsafe_membership,
    exists (
      select 1 from pg_catalog.pg_database as database
        where database.datdba = login.oid
      union all
      select 1 from pg_catalog.pg_namespace as namespace
        where namespace.nspowner = login.oid
      union all
      select 1 from pg_catalog.pg_class as relation
        where relation.relowner = login.oid
      union all
      select 1 from pg_catalog.pg_proc as procedure
        where procedure.proowner = login.oid
      union all
      select 1 from pg_catalog.pg_type as type
        where type.typowner = login.oid
      union all
      select 1 from pg_catalog.pg_extension as extension
        where extension.extowner = login.oid
      union all
      select 1 from pg_catalog.pg_default_acl as defaults
        where defaults.defaclrole = login.oid
    ) or exists (
      select 1 from pg_catalog.pg_database as database
        cross join lateral pg_catalog.aclexplode(database.datacl) as access
        where login.oid in (access.grantee, access.grantor)
      union all
      select 1 from pg_catalog.pg_namespace as namespace
        cross join lateral pg_catalog.aclexplode(namespace.nspacl) as access
        where login.oid in (access.grantee, access.grantor)
      union all
      select 1 from pg_catalog.pg_class as relation
        cross join lateral pg_catalog.aclexplode(relation.relacl) as access
        where login.oid in (access.grantee, access.grantor)
      union all
      select 1 from pg_catalog.pg_proc as procedure
        cross join lateral pg_catalog.aclexplode(procedure.proacl) as access
        where login.oid in (access.grantee, access.grantor)
      union all
      select 1 from pg_catalog.pg_type as type
        cross join lateral pg_catalog.aclexplode(type.typacl) as access
        where login.oid in (access.grantee, access.grantor)
      union all
      select 1 from pg_catalog.pg_default_acl as defaults
        cross join lateral pg_catalog.aclexplode(defaults.defaclacl) as access
        where login.oid in (access.grantee, access.grantor)
    ) as has_unsafe_access
  from pg_catalog.pg_roles login
  cross join pg_catalog.pg_roles authorization
  cross join pg_catalog.pg_roles operator
  cross join pg_catalog.pg_roles creator
  where login.rolname = 'app_runtime_login'
    and authorization.rolname = 'app_runtime'
    and operator.rolname = 'postgres'
    and creator.rolname = 'supabase_admin'
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

export const RUNTIME_PASSWORD_CONFIG_SQL =
  "select set_config('gioia.test_runtime_password', $1, true)";
export const RUNTIME_ROLE_GRANT_SQL =
  "grant app_runtime to postgres with inherit false, set true granted by current_user";
export const RUNTIME_ROLE_ALTER_SQL = `
  do $role$
  begin
    execute pg_catalog.format(
      'alter role app_runtime login password %L valid until %L',
      pg_catalog.current_setting('gioia.test_runtime_password'),
      pg_catalog.clock_timestamp() + interval '15 minutes'
    );
  end
  $role$
`;
export const RUNTIME_ROLE_DISABLE_SQL =
  "alter role app_runtime nologin password null valid until 'infinity'";
export const RUNTIME_ROLE_REVOKE_SQL =
  "revoke app_runtime from postgres granted by current_user";
export const RUNTIME_SESSION_TERMINATE_SQL = `
  select pg_catalog.pg_terminate_backend(pid) as terminated
  from pg_catalog.pg_stat_activity
  where pid <> pg_catalog.pg_backend_pid()
    and datname = pg_catalog.current_database()
    and (usename = 'app_runtime' or application_name = 'gioia_public_api')
`;
export const RUNTIME_SESSION_STATE_SQL = `
  select count(*)::integer as active
  from pg_catalog.pg_stat_activity
  where pid <> pg_catalog.pg_backend_pid()
    and datname = pg_catalog.current_database()
    and (usename = 'app_runtime' or application_name = 'gioia_public_api')
`;
export const RUNTIME_ROLE_STATE_SQL = `
  select role.rolcanlogin,
    not role.rolsuper and not role.rolinherit and not role.rolcreaterole and
      not role.rolcreatedb and not role.rolreplication and not role.rolbypassrls and
      role.rolconnlimit = -1 and
      (role.rolvaliduntil is null or role.rolvaliduntil = 'infinity'::timestamptz) and
      (select pg_catalog.array_agg(setting order by setting)
        from pg_catalog.unnest(coalesce(role.rolconfig, '{}')) as config(setting))
        = array['lock_timeout=3s','statement_timeout=10s']::text[]
      as attributes_are_safe,
    exists (
      select 1 from pg_catalog.pg_auth_members membership
      join pg_catalog.pg_roles granted on granted.oid = membership.roleid
      join pg_catalog.pg_roles member on member.oid = membership.member
      where (granted.rolname = 'app_runtime'
        and (member.rolname <> 'postgres' or not membership.admin_option
          or membership.inherit_option or membership.set_option))
        or member.rolname = 'app_runtime'
    ) as has_unsafe_membership
  from pg_catalog.pg_roles role
  where role.rolname = 'app_runtime'
`;
export const PREVIEW_ROLE_RESTORE_SQL = `
  do $role$
  begin
    execute pg_catalog.format(
      'alter role app_runtime login password %L valid until %L',
      pg_catalog.current_setting('gioia.test_runtime_password'),
      'infinity'
    );
  end
  $role$
`;
export const PREVIEW_ROLE_AUTHENTICATE_SQL = `
  select session_user = 'app_runtime' and current_user = 'app_runtime'
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
  restore: Object.freeze([
    RUNTIME_PASSWORD_CONFIG_SQL,
    PREVIEW_ROLE_RESTORE_SQL,
  ]),
});

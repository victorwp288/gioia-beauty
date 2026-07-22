export const RUNTIME_SESSION_STATE_SQL = `
  select count(*)::integer as active
  from pg_catalog.pg_stat_activity
  where pid <> pg_catalog.pg_backend_pid()
    and datname = pg_catalog.current_database()
    and (usename = 'app_runtime' or application_name = 'gioia_public_api')
    and not (
      usename = 'app_runtime'
      and application_name = 'Supavisor'
      and state = 'idle'
      and wait_event_type = 'Client'
      and wait_event = 'ClientRead'
    )
`;

export const RUNTIME_ROLE_STATE_SQL = `
  select runtime_role.rolcanlogin,
    not runtime_role.rolsuper and not runtime_role.rolinherit and
      not runtime_role.rolcreaterole and not runtime_role.rolcreatedb and
      not runtime_role.rolreplication and not runtime_role.rolbypassrls and
      runtime_role.rolconnlimit = -1 and
      runtime_role.rolvaliduntil = 'infinity'::timestamptz and
      (select pg_catalog.array_agg(setting order by setting)
        from pg_catalog.unnest(coalesce(runtime_role.rolconfig, '{}')) as config(setting))
        = array['lock_timeout=3s','statement_timeout=10s']::text[]
      as attributes_are_safe,
    runtime_auth.rolpassword like 'SCRAM-SHA-256$%'
      as credential_is_safe,
    runtime_auth.rolpassword is null as credential_is_missing,
    (select count(*)
      from pg_catalog.pg_auth_members membership
      where membership.roleid = runtime_role.oid
        or membership.member = runtime_role.oid) <> 1 or
    not exists (
      select 1
      from pg_catalog.pg_auth_members membership
      where membership.roleid = runtime_role.oid
        and membership.member = operator_role.oid
        and membership.grantor = creator_role.oid
        and membership.admin_option
        and not membership.inherit_option
        and not membership.set_option
    ) as has_unsafe_membership,
    exists (
      select 1 from pg_catalog.pg_database as database_object
        where database_object.datdba = runtime_role.oid
      union all
      select 1 from pg_catalog.pg_namespace as namespace_object
        where namespace_object.nspowner = runtime_role.oid
      union all
      select 1 from pg_catalog.pg_class as relation_object
        where relation_object.relowner = runtime_role.oid
      union all
      select 1 from pg_catalog.pg_proc as procedure_object
        where procedure_object.proowner = runtime_role.oid
      union all
      select 1 from pg_catalog.pg_type as type_object
        where type_object.typowner = runtime_role.oid
      union all
      select 1 from pg_catalog.pg_extension as extension_object
        where extension_object.extowner = runtime_role.oid
      union all
      select 1 from pg_catalog.pg_default_acl as default_acl
        where default_acl.defaclrole = runtime_role.oid
      union all
      select 1 from pg_catalog.pg_class as relation_object
        cross join lateral pg_catalog.aclexplode(relation_object.relacl) as access
        where access.grantee = runtime_role.oid
          and relation_object.relkind in ('r','p','v','m','S','f')
    ) as has_unsafe_access
  from pg_catalog.pg_roles runtime_role
  join pg_catalog.pg_authid runtime_auth on runtime_auth.oid = runtime_role.oid
  cross join pg_catalog.pg_roles operator_role
  cross join pg_catalog.pg_roles creator_role
  where runtime_role.rolname = 'app_runtime'
    and operator_role.rolname = 'postgres'
    and creator_role.rolname = 'supabase_admin'
`;

export const RUNTIME_ROLE_AUTHENTICATE_SQL = `
  select session_user = 'app_runtime' and
    current_user = 'app_runtime'
    as authorized
`;
export const RUNTIME_PASSWORD_CONFIG_SQL =
  "select set_config('gioia.test_runtime_password', $1, true)";
export const RUNTIME_ROLE_PROVISION_SQL = `
  do $role$
  declare current_password text;
  begin
    select rolpassword into strict current_password
    from pg_catalog.pg_authid where rolname='app_runtime';
    if current_password is not null then
      raise exception 'Direct runtime credential already exists';
    end if;
    execute pg_catalog.format(
      'alter role app_runtime login password %L valid until %L',
      pg_catalog.current_setting('gioia.test_runtime_password'),
      'infinity'
    );
  end
  $role$
`;
// Keep the legacy probe slot rowless: direct runtime authentication no longer
// assumes another role, and the one-shot verifier expects exactly two booleans.
export const RUNTIME_ROLE_ASSUME_SQL = "select true where false";
export const RUNTIME_ROLE_AUTHORIZE_SQL = `
  select session_user = 'app_runtime' and
    current_user = 'app_runtime' and
    (select count(*) = 1 from gioia_private.get_cutover_write_state())
    as authorized
`;

export const GREENFIELD_RUNTIME_ROLE_SQL = Object.freeze({
  authenticate: RUNTIME_ROLE_AUTHENTICATE_SQL,
  assume: RUNTIME_ROLE_ASSUME_SQL,
  authorize: RUNTIME_ROLE_AUTHORIZE_SQL,
  provision: Object.freeze([
    RUNTIME_PASSWORD_CONFIG_SQL,
    RUNTIME_ROLE_PROVISION_SQL,
  ]),
  sessions: RUNTIME_SESSION_STATE_SQL,
  state: RUNTIME_ROLE_STATE_SQL,
});

// Transitional aliases keep consumers source-compatible while the semantic
// contract is now one durable direct runtime principal.
export const PREVIEW_ROLE_AUTHENTICATE_SQL = RUNTIME_ROLE_AUTHENTICATE_SQL;
export const PREVIEW_ROLE_ASSUME_SQL = RUNTIME_ROLE_ASSUME_SQL;
export const PREVIEW_ROLE_AUTHORIZE_SQL = RUNTIME_ROLE_AUTHORIZE_SQL;
export const GREENFIELD_PREVIEW_ROLE_SQL = GREENFIELD_RUNTIME_ROLE_SQL;

import {
  GREENFIELD_EXPECTED_ROLE_NAMES,
  GREENFIELD_EXPECTED_SCHEMA_NAMES,
} from "./test-target-fixture-sql.mjs";
import { GREENFIELD_REBUILD_GUARD_SQL } from "./test-target-rebuild-guard-sql.mjs";
import { GREENFIELD_TARGET_VERSIONS } from "./test-target-migrations.mjs";

export { GREENFIELD_REBUILD_GUARD_SQL };

const CUSTOM_ROLES = Object.freeze([
  "app_runtime",
  "gioia_migrator",
  "gioia_mutator",
]);
const DROPPED_ROLES = Object.freeze(["gioia_migrator", "gioia_mutator"]);
const literal = (value) => `'${value.replaceAll("'", "''")}'`;
const textArray = (values) => `array[${values.map(literal).join(",")}]::text[]`;
const CUSTOM_ROLES_SQL = textArray(CUSTOM_ROLES);
const SURVIVING_DEFAULT_ACLS_SQL = `(select coalesce(jsonb_agg(to_jsonb(x)
  order by x.owner,x.schema nulls first,x.object_type,x.grantee,x.grantor,x.privilege,x.grantable),'[]'::jsonb)
  from (select owner.rolname::text owner,n.nspname::text schema,
    d.defaclobjtype::text object_type,coalesce(grantee.rolname,'PUBLIC')::text grantee,
    coalesce(grantor.rolname,'PUBLIC')::text grantor,a.privilege_type::text privilege,
    a.is_grantable grantable from pg_catalog.pg_default_acl d
    join pg_catalog.pg_roles owner on owner.oid=d.defaclrole
    left join pg_catalog.pg_namespace n on n.oid=d.defaclnamespace
    cross join lateral pg_catalog.aclexplode(d.defaclacl) a
    left join pg_catalog.pg_roles grantee on grantee.oid=a.grantee
    left join pg_catalog.pg_roles grantor on grantor.oid=a.grantor
    where owner.rolname<>all(${CUSTOM_ROLES_SQL})) x)`;
const SURVIVING_SCHEMA_ACLS_SQL = `(select coalesce(jsonb_agg(to_jsonb(x)
  order by x.schema,x.grantee,x.grantor,x.privilege,x.grantable),'[]'::jsonb)
  from (select n.nspname::text schema,coalesce(grantee.rolname,'PUBLIC')::text grantee,
    coalesce(grantor.rolname,'PUBLIC')::text grantor,a.privilege_type::text privilege,
    a.is_grantable grantable from pg_catalog.pg_namespace n
    cross join lateral pg_catalog.aclexplode(n.nspacl) a
    left join pg_catalog.pg_roles grantee on grantee.oid=a.grantee
    left join pg_catalog.pg_roles grantor on grantor.oid=a.grantor
    where n.nspname<>'gioia_private' and n.nspname!~'^pg_temp_' and n.nspname!~'^pg_toast_temp_'
      and coalesce(grantee.rolname,'PUBLIC')<>all(${CUSTOM_ROLES_SQL})
      and coalesce(grantor.rolname,'PUBLIC')<>all(${CUSTOM_ROLES_SQL})) x)`;
const POST_ROLES = GREENFIELD_EXPECTED_ROLE_NAMES.filter(
  (role) => !DROPPED_ROLES.includes(role),
);
const POST_SCHEMAS = GREENFIELD_EXPECTED_SCHEMA_NAMES.filter(
  (schema) => schema !== "gioia_private",
);
const VERIFY_FIELDS = Object.freeze([
  "history_empty",
  "roles_removed",
  "schema_removed",
  "roles_exact",
  "schemas_exact",
  "schemas_preserved",
  "roles_preserved",
  "runtime_credential_preserved",
  "extensions_preserved",
  "default_acls_preserved",
  "schema_acls_preserved",
  "public_empty",
]);

export const GREENFIELD_REBUILD_TRANSACTION_SQL = Object.freeze([
  "set transaction isolation level serializable",
  "set local lock_timeout = '5s'",
  "set local statement_timeout = '30s'",
  "set local idle_in_transaction_session_timeout = '30s'",
]);

export const GREENFIELD_REBUILD_SNAPSHOT_SQL = `
create temporary table gioia_rebuild_snapshot on commit drop as
select
  (select jsonb_agg(jsonb_build_object('name',n.nspname,'owner',r.rolname) order by n.nspname)
    from pg_catalog.pg_namespace n join pg_catalog.pg_roles r on r.oid=n.nspowner
    where n.nspname<>'gioia_private' and n.nspname!~'^pg_temp_' and n.nspname!~'^pg_toast_temp_') as schemas,
  (select jsonb_agg(to_jsonb(x) order by x.rolname) from (select oid,rolname,rolsuper,rolinherit,
    rolcreaterole,rolcreatedb,rolcanlogin,rolreplication,rolconnlimit,rolvaliduntil,
    rolbypassrls,rolconfig from pg_catalog.pg_roles
    where rolname<>all(${textArray(DROPPED_ROLES)})) x) as roles,
  (select to_jsonb(x) from (select oid,rolname,rolsuper,rolinherit,
    rolcreaterole,rolcreatedb,rolcanlogin,rolreplication,rolconnlimit,rolvaliduntil,
    rolbypassrls,rolconfig from pg_catalog.pg_roles where rolname='app_runtime') x)
    as runtime_role,
  (select pg_catalog.encode(extensions.digest(coalesce(rolpassword,'')::text,'sha256'),'hex')
    from pg_catalog.pg_authid where rolname='app_runtime') as runtime_password_digest,
  (select jsonb_agg(jsonb_build_object('name',e.extname,'owner',r.rolname,'schema',n.nspname,
    'version',e.extversion,'relocatable',e.extrelocatable,'config',e.extconfig,'condition',e.extcondition)
    order by e.extname) from pg_catalog.pg_extension e join pg_catalog.pg_roles r on r.oid=e.extowner
    join pg_catalog.pg_namespace n on n.oid=e.extnamespace) as extensions,
  (select min(created_by) from supabase_migrations.schema_migrations)
    as migration_created_by,
  ${SURVIVING_DEFAULT_ACLS_SQL} as default_acls,
  ${SURVIVING_SCHEMA_ACLS_SQL} as schema_acls`;

export const GREENFIELD_REBUILD_MUTATION_SQL = Object.freeze([
  "grant gioia_mutator, gioia_migrator to postgres with inherit true, set false granted by current_user",
  "do $$ begin if not pg_catalog.pg_has_role(current_user,'gioia_mutator','USAGE') or not pg_catalog.pg_has_role(current_user,'gioia_migrator','USAGE') then raise exception 'Greenfield TEST temporary default-ACL membership failed'; end if; end $$",
  "alter default privileges for role gioia_mutator grant execute on functions to public",
  "alter default privileges for role gioia_migrator grant execute on functions to public",
  "revoke gioia_mutator, gioia_migrator from postgres granted by current_user",
  "do $$ begin if pg_catalog.pg_has_role(current_user,'gioia_mutator','USAGE') or pg_catalog.pg_has_role(current_user,'gioia_migrator','USAGE') then raise exception 'Greenfield TEST temporary default-ACL membership remained'; end if; end $$",
  "revoke usage on schema extensions from gioia_mutator, gioia_migrator",
  "drop schema gioia_private cascade",
  "drop role gioia_migrator, gioia_mutator",
]);

export const GREENFIELD_REBUILD_DELETE_HISTORY_SQL = `
with removed as (
  delete from supabase_migrations.schema_migrations
  where version::text=any(${textArray(GREENFIELD_TARGET_VERSIONS)}) returning version
) select count(*)::integer as removed_migrations from removed`;

export const GREENFIELD_REBUILD_VERIFY_SQL = `
select
  (select count(*)=0 from supabase_migrations.schema_migrations) as history_empty,
  (select count(*)=0 from pg_catalog.pg_roles where rolname=any(${textArray(DROPPED_ROLES)}))
    and (select count(*)=1 from pg_catalog.pg_roles where rolname='app_runtime') as roles_removed,
  (select count(*)=0 from pg_catalog.pg_namespace where nspname='gioia_private') as schema_removed,
  (select array_agg(rolname::text order by rolname) from pg_catalog.pg_roles)=${textArray(POST_ROLES)} as roles_exact,
  (select array_agg(nspname::text order by nspname) from pg_catalog.pg_namespace
    where nspname!~'^pg_temp_' and nspname!~'^pg_toast_temp_')=${textArray(POST_SCHEMAS)} as schemas_exact,
  (select jsonb_agg(jsonb_build_object('name',n.nspname,'owner',r.rolname) order by n.nspname)
    from pg_catalog.pg_namespace n join pg_catalog.pg_roles r on r.oid=n.nspowner
    where n.nspname!~'^pg_temp_' and n.nspname!~'^pg_toast_temp_')
    =(select schemas from gioia_rebuild_snapshot) as schemas_preserved,
  (select jsonb_agg(to_jsonb(x) order by x.rolname) from (select oid,rolname,rolsuper,rolinherit,
    rolcreaterole,rolcreatedb,rolcanlogin,rolreplication,rolconnlimit,rolvaliduntil,
    rolbypassrls,rolconfig from pg_catalog.pg_roles) x)
    =(select roles from gioia_rebuild_snapshot) as roles_preserved,
  (select pg_catalog.encode(extensions.digest(coalesce(rolpassword,'')::text,'sha256'),'hex')
    from pg_catalog.pg_authid where rolname='app_runtime')
    =(select runtime_password_digest from gioia_rebuild_snapshot) as runtime_credential_preserved,
  (select jsonb_agg(jsonb_build_object('name',e.extname,'owner',r.rolname,'schema',n.nspname,
    'version',e.extversion,'relocatable',e.extrelocatable,'config',e.extconfig,
    'condition',e.extcondition) order by e.extname)
    from pg_catalog.pg_extension e join pg_catalog.pg_roles r on r.oid=e.extowner
    join pg_catalog.pg_namespace n on n.oid=e.extnamespace)
    =(select extensions from gioia_rebuild_snapshot) as extensions_preserved,
  ${SURVIVING_DEFAULT_ACLS_SQL}=(select default_acls from gioia_rebuild_snapshot)
    as default_acls_preserved,
  ${SURVIVING_SCHEMA_ACLS_SQL}=(select schema_acls from gioia_rebuild_snapshot)
    as schema_acls_preserved,
  not exists(select 1 from pg_catalog.pg_class c join pg_catalog.pg_namespace n
    on n.oid=c.relnamespace where n.nspname='public') and
  not exists(select 1 from pg_catalog.pg_proc p join pg_catalog.pg_namespace n
  on n.oid=p.pronamespace where n.nspname='public') as public_empty`;

export const GREENFIELD_REBUILD_RUNTIME_PRESERVATION_SQL = `
select
  (select to_jsonb(x) from (select oid,rolname,rolsuper,rolinherit,
    rolcreaterole,rolcreatedb,rolcanlogin,rolreplication,rolconnlimit,rolvaliduntil,
    rolbypassrls,rolconfig from pg_catalog.pg_roles where rolname='app_runtime') x)
      =(select runtime_role from gioia_rebuild_snapshot) and
  (select pg_catalog.encode(extensions.digest(coalesce(rolpassword,'')::text,'sha256'),'hex')
    from pg_catalog.pg_authid where rolname='app_runtime')
      =(select runtime_password_digest from gioia_rebuild_snapshot)
    as runtime_role_preserved
`;

function exactRow(rows, message) {
  if (!Array.isArray(rows) || rows.length !== 1) throw new Error(message);
  return rows[0];
}

export async function rebuildGreenfieldTestDatabaseInTransaction(transaction) {
  if (!transaction || typeof transaction.unsafe !== "function") {
    throw new Error("Greenfield TEST teardown requires an atomic transaction");
  }
  for (const statement of GREENFIELD_REBUILD_TRANSACTION_SQL) {
    await transaction.unsafe(statement);
  }
  await transaction.unsafe(GREENFIELD_REBUILD_GUARD_SQL);
  const [mode] = await transaction.unsafe(
    "select count(*)::integer as migration_count from supabase_migrations.schema_migrations",
  );
  const expectedCount = Number(mode?.migration_count);
  if (expectedCount !== GREENFIELD_TARGET_VERSIONS.length) {
    throw new Error("Greenfield TEST rebuild pre-state is invalid");
  }
  await transaction.unsafe(GREENFIELD_REBUILD_SNAPSHOT_SQL);
  for (const statement of GREENFIELD_REBUILD_MUTATION_SQL) {
    await transaction.unsafe(statement);
  }
  const removed = exactRow(
    await transaction.unsafe(GREENFIELD_REBUILD_DELETE_HISTORY_SQL),
    "Greenfield TEST migration removal did not reconcile",
  );
  if (Number(removed.removed_migrations) !== expectedCount) {
    throw new Error("Greenfield TEST migration removal did not reconcile");
  }
  const verified = exactRow(
    await transaction.unsafe(GREENFIELD_REBUILD_VERIFY_SQL),
    "Greenfield TEST rebuild verification failed",
  );
  if (
    Object.keys(verified).length !== VERIFY_FIELDS.length ||
    VERIFY_FIELDS.some((field) => verified[field] !== true)
  ) {
    throw new Error("Greenfield TEST rebuild verification failed");
  }
  return Object.freeze({ removedMigrations: expectedCount });
}

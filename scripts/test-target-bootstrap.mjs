import {
  applyGreenfieldMigrationPlan,
  verifyGreenfieldMigrationHistory,
} from "./test-target-atomic-rebuild.mjs";
import {
  GREENFIELD_EXPECTED_ROLE_NAMES,
  GREENFIELD_EXPECTED_SCHEMA_NAMES,
  assertCleanGreenfield,
} from "./test-target-fixtures.mjs";
import { GREENFIELD_TARGET_VERSIONS } from "./test-target-migrations.mjs";
import {
  GREENFIELD_PRISTINE_BASELINE_EVIDENCE_SQL,
  assertGreenfieldPristineBaselineEvidence,
} from "./test-target-pristine-manifest-sql.mjs";

const CUSTOM_ROLES = Object.freeze([
  "app_runtime",
  "gioia_migrator",
  "gioia_mutator",
]);
const PRISTINE_ROLE_NAMES = GREENFIELD_EXPECTED_ROLE_NAMES.filter(
  (role) => !CUSTOM_ROLES.includes(role),
);
const PRISTINE_SCHEMA_NAMES = GREENFIELD_EXPECTED_SCHEMA_NAMES.filter(
  (schema) => schema !== "gioia_private" && schema !== "supabase_migrations",
);
const AUTH_TABLES = Object.freeze(
  `audit_log_entries custom_oauth_providers flow_state identities instances
  mfa_amr_claims mfa_challenges mfa_factors oauth_authorizations
  oauth_client_states oauth_clients oauth_consents one_time_tokens
  refresh_tokens saml_providers saml_relay_states sessions sso_domains
  sso_providers users webauthn_challenges webauthn_credentials`.split(/\s+/u),
);
const STORAGE_TABLES = Object.freeze(
  `buckets buckets_analytics buckets_vectors objects s3_multipart_uploads
  s3_multipart_uploads_parts vector_indexes`.split(/\s+/u),
);

const literal = (value) => `'${value.replaceAll("'", "''")}'`;
const textArray = (values) => `array[${values.map(literal).join(",")}]::text[]`;

export const GREENFIELD_REFERENCE_ROW_COUNT = 205;

export const GREENFIELD_BOOTSTRAP_INSPECT_SQL = `
  select exists (
    select 1 from pg_catalog.pg_class c
    join pg_catalog.pg_namespace n on n.oid=c.relnamespace
    where n.nspname='supabase_migrations' and
      c.relname='schema_migrations' and c.relkind='r'
  ) as history_exists
`;

export const GREENFIELD_BOOTSTRAP_HISTORY_INSERT_SQL = `
  insert into supabase_migrations.schema_migrations (
    version, statements, name
  ) values ($1::text, array[$2::text], $3::text)
`;

export const GREENFIELD_BOOTSTRAP_HISTORY_SCHEMA_SQL = Object.freeze([
  "create schema supabase_migrations authorization postgres",
  `create table supabase_migrations.schema_migrations (
    version text primary key,
    statements text[],
    name text
  )`,
]);

export const GREENFIELD_PRISTINE_BASELINE_GUARD_SQL = `
do $guard$
declare
  actual_roles text[];
  actual_schemas text[];
  table_name text;
  row_total bigint;
begin
  if current_user <> 'postgres' then
    raise exception 'Greenfield TEST bootstrap requires postgres';
  end if;
  if pg_catalog.pg_try_advisory_xact_lock(7102026, 72135538) then
    raise exception 'Greenfield TEST advisory lock is not held by the lock session';
  end if;
  select pg_catalog.array_agg(rolname::text order by rolname)
    into actual_roles from pg_catalog.pg_roles;
  select pg_catalog.array_agg(nspname::text order by nspname)
    into actual_schemas from pg_catalog.pg_namespace
    where nspname !~ '^pg_temp_' and nspname !~ '^pg_toast_temp_';
  if actual_roles <> ${textArray(PRISTINE_ROLE_NAMES)} or
     actual_schemas <> ${textArray(PRISTINE_SCHEMA_NAMES)} then
    raise exception 'Greenfield TEST hosted baseline catalog is not pristine';
  end if;

  if exists (select 1 from pg_catalog.pg_class c
      join pg_catalog.pg_namespace n on n.oid=c.relnamespace
      where n.nspname='public') or
     exists (select 1 from pg_catalog.pg_proc p
      join pg_catalog.pg_namespace n on n.oid=p.pronamespace
      where n.nspname='public') or
     exists (select 1 from pg_catalog.pg_policy p
      join pg_catalog.pg_class c on c.oid=p.polrelid
      join pg_catalog.pg_namespace n on n.oid=c.relnamespace
      where n.nspname='public') or
     exists (select 1 from pg_catalog.pg_extension where extname='pgtap') then
    raise exception 'Greenfield TEST hosted baseline contains user objects';
  end if;
  if exists (select 1 from pg_catalog.pg_stat_activity
      where pid<>pg_catalog.pg_backend_pid() and
        datname=pg_catalog.current_database() and
        (usename=any(${textArray(CUSTOM_ROLES)}) or
          application_name='gioia_public_api')) then
    raise exception 'Greenfield TEST application sessions are active';
  end if;

  foreach table_name in array ${textArray(AUTH_TABLES)} loop
    execute pg_catalog.format('select count(*) from auth.%I',table_name)
      into row_total;
    if row_total<>0 then
      raise exception 'Greenfield TEST pristine Auth state is not empty';
    end if;
  end loop;
  foreach table_name in array ${textArray(STORAGE_TABLES)} loop
    execute pg_catalog.format('select count(*) from storage.%I',table_name)
      into row_total;
    if row_total<>0 then
      raise exception 'Greenfield TEST pristine Storage state is not empty';
    end if;
  end loop;
end
$guard$
`;

const GREENFIELD_BOOTSTRAP_TRANSACTION_SQL = Object.freeze([
  "set transaction isolation level serializable",
  "set local lock_timeout = '5s'",
  "set local statement_timeout = '5min'",
  "set local idle_in_transaction_session_timeout = '5min'",
]);

async function noFault() {}

function exactHistoryExists(row) {
  if (typeof row?.history_exists !== "boolean") {
    throw new Error("Greenfield TEST bootstrap inspection is invalid");
  }
  return row.history_exists;
}

async function inspectHistoryExists(sql) {
  const [row, ...extra] = await sql.unsafe(GREENFIELD_BOOTSTRAP_INSPECT_SQL);
  if (!row || extra.length !== 0) {
    throw new Error("Greenfield TEST bootstrap inspection is invalid");
  }
  return exactHistoryExists(row);
}

function result(bootstrapped, fingerprint) {
  return Object.freeze({
    bootstrapped,
    migrationCount: GREENFIELD_TARGET_VERSIONS.length,
    referenceRows: GREENFIELD_REFERENCE_ROW_COUNT,
    ...fingerprint,
  });
}

export async function bootstrapGreenfieldTestProject(
  sql,
  plan,
  { assertClean = assertCleanGreenfield, fault = noFault } = {},
) {
  if (
    !sql ||
    typeof sql.unsafe !== "function" ||
    typeof sql.begin !== "function" ||
    typeof assertClean !== "function" ||
    typeof fault !== "function"
  ) {
    throw new Error("Greenfield TEST bootstrap operations are invalid");
  }

  const historyExists = await inspectHistoryExists(sql);
  if (historyExists) {
    await verifyGreenfieldMigrationHistory(sql, plan);
    return result(false, await assertClean(sql, GREENFIELD_TARGET_VERSIONS));
  }
  return sql.begin(async (transaction) => {
    for (const statement of GREENFIELD_BOOTSTRAP_TRANSACTION_SQL) {
      await transaction.unsafe(statement);
    }
    const [evidence, ...extraEvidence] = await transaction.unsafe(
      GREENFIELD_PRISTINE_BASELINE_EVIDENCE_SQL,
    );
    if (!evidence || extraEvidence.length !== 0) {
      throw new Error("Greenfield TEST hosted provider evidence is invalid");
    }
    assertGreenfieldPristineBaselineEvidence(evidence);
    await transaction.unsafe(GREENFIELD_PRISTINE_BASELINE_GUARD_SQL);
    await fault("after-pristine-guard", -1);
    for (const statement of GREENFIELD_BOOTSTRAP_HISTORY_SCHEMA_SQL) {
      await transaction.unsafe(statement);
    }
    await fault("after-history-schema", -1);
    const migrations = await applyGreenfieldMigrationPlan(transaction, plan, {
      fault,
      historyInsertSql: GREENFIELD_BOOTSTRAP_HISTORY_INSERT_SQL,
    });
    if (migrations.length !== GREENFIELD_TARGET_VERSIONS.length) {
      throw new Error("Greenfield TEST bootstrap migration count is invalid");
    }
    await fault("before-bootstrap-check", migrations.length);
    const fingerprint = await assertClean(
      transaction,
      GREENFIELD_TARGET_VERSIONS,
    );
    await fault("after-bootstrap-check", migrations.length);
    return result(true, fingerprint);
  });
}

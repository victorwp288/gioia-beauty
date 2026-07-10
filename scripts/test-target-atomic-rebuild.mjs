import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import path from "node:path";

import { assertCleanGreenfield } from "./test-target-fixtures.mjs";
import {
  GREENFIELD_TARGET_VERSIONS,
  repositoryMigrationFiles,
} from "./test-target-migrations.mjs";
import { rebuildGreenfieldTestDatabaseInTransaction } from "./test-target-rebuild-sql.mjs";
import { REVIEWED_MIGRATION_DIGESTS } from "./test-target-reviewed-manifest.mjs";

const HISTORY_INSERT_SQL = `
  insert into supabase_migrations.schema_migrations (
    version, statements, name, created_by
  ) select $1::text, array[$2::text], $3::text, migration_created_by
  from gioia_rebuild_snapshot
`;
const HISTORY_VERIFY_SQL = `
  select version::text as version, name::text as name,
    statements[1]::text as statement
  from supabase_migrations.schema_migrations history
  where name is not null and octet_length(name) between 1 and 255 and
    created_by is not null and cardinality(statements)=1 and
    idempotency_key is null and rollback is null and
    (select count(distinct created_by)
      from supabase_migrations.schema_migrations)=1
  order by version::text
`;
const TRANSACTION_CONTROL =
  /^\s*(?:begin|start\s+transaction|commit|rollback|savepoint|release\s+savepoint)\s*;\s*$/imu;
const TRANSACTION_INCOMPATIBLE =
  /^\s*(?:vacuum|cluster|alter\s+system|create\s+(?:unique\s+)?index\s+concurrently|reindex\b[^;]*\bconcurrently|refresh\s+materialized\s+view\s+concurrently|create\s+database|drop\s+database)\b/imu;
const VALID_PLANS = new WeakSet();

export const GREENFIELD_HISTORY_INSERT_SQL = HISTORY_INSERT_SQL;
export const GREENFIELD_HISTORY_VERIFY_SQL = HISTORY_VERIFY_SQL;

function migrationName(file) {
  const match = file.match(/^\d{14}_([a-z0-9_]+)\.sql$/u);
  if (!match) throw new Error("Greenfield TEST migration name is invalid");
  return match[1];
}

function reviewedMigrationSource(rootDirectory, file) {
  const bytes = readFileSync(
    path.join(rootDirectory, "supabase", "migrations", file),
  );
  const digest = createHash("sha256").update(bytes).digest("hex");
  if (digest !== REVIEWED_MIGRATION_DIGESTS[file]) {
    throw new Error("Greenfield TEST executable migration is not reviewed");
  }
  return bytes.toString("utf8");
}

function stripTransactionEnvelope(source) {
  const lines = source.split("\n");
  if (lines.at(-1) === "") lines.pop();
  const controls = lines.flatMap((line, index) =>
    /^(?:begin|commit);$/iu.test(line.trim()) ? [{ index, line }] : [],
  );
  const beginIndex = controls[0]?.index;
  const commitIndex = controls[1]?.index;
  if (
    controls.length !== 2 ||
    controls[0]?.line.trim().toLowerCase() !== "begin;" ||
    controls[1]?.line.trim().toLowerCase() !== "commit;" ||
    !Number.isInteger(beginIndex) ||
    !Number.isInteger(commitIndex) ||
    beginIndex >= commitIndex ||
    lines.slice(0, beginIndex).some((line) => {
      const trimmed = line.trim();
      return trimmed !== "" && !trimmed.startsWith("--");
    }) ||
    lines.slice(commitIndex + 1).some((line) => line.trim() !== "")
  ) {
    throw new Error(
      "Greenfield TEST migration transaction envelope is invalid",
    );
  }
  const body = `${[
    ...lines.slice(0, beginIndex),
    ...lines.slice(beginIndex + 1, commitIndex),
  ]
    .join("\n")
    .trim()}\n`;
  if (
    body.length === 0 ||
    TRANSACTION_CONTROL.test(body) ||
    TRANSACTION_INCOMPATIBLE.test(body)
  ) {
    throw new Error("Greenfield TEST migration is not atomic-safe");
  }
  return body;
}

function safeMigration({ body, file, name, source, version }) {
  const migration = { file, name, version };
  Object.defineProperties(migration, {
    getBody: { value: () => body },
    getSource: { value: () => source },
  });
  return Object.freeze(migration);
}

export function planGreenfieldAtomicRebuild(rootDirectory = process.cwd()) {
  const files = repositoryMigrationFiles(rootDirectory);
  const migrations = Object.freeze(
    files.map((file, index) => {
      const source = reviewedMigrationSource(rootDirectory, file);
      return safeMigration({
        body: stripTransactionEnvelope(source),
        file,
        name: migrationName(file),
        source,
        version: GREENFIELD_TARGET_VERSIONS[index],
      });
    }),
  );
  const plan = {
    migrationCount: migrations.length,
    files: Object.freeze([...files]),
  };
  Object.defineProperty(plan, "getMigrations", {
    value: () => migrations,
  });
  Object.freeze(plan);
  VALID_PLANS.add(plan);
  return plan;
}

function validatePlan(plan) {
  if (
    !plan ||
    !VALID_PLANS.has(plan) ||
    plan.migrationCount !== GREENFIELD_TARGET_VERSIONS.length ||
    !Array.isArray(plan.files) ||
    plan.files.length !== GREENFIELD_TARGET_VERSIONS.length ||
    typeof plan.getMigrations !== "function"
  ) {
    throw new Error("Greenfield TEST atomic rebuild plan is invalid");
  }
  const migrations = plan.getMigrations();
  if (
    !Array.isArray(migrations) ||
    migrations.length !== GREENFIELD_TARGET_VERSIONS.length ||
    migrations.some(
      (migration, index) =>
        migration.version !== GREENFIELD_TARGET_VERSIONS[index] ||
        migration.file !== plan.files[index] ||
        typeof migration.getBody !== "function" ||
        typeof migration.getSource !== "function",
    )
  ) {
    throw new Error("Greenfield TEST atomic migration sequence is invalid");
  }
  return migrations;
}

async function noFault() {}

export async function rebuildGreenfieldTestAtomically(
  sql,
  plan,
  {
    assertClean = assertCleanGreenfield,
    fault = noFault,
    rebuild = rebuildGreenfieldTestDatabaseInTransaction,
  } = {},
) {
  if (!sql || typeof sql.begin !== "function") {
    throw new Error(
      "Greenfield TEST atomic rebuild requires a database client",
    );
  }
  if (
    typeof assertClean !== "function" ||
    typeof fault !== "function" ||
    typeof rebuild !== "function"
  ) {
    throw new Error("Greenfield TEST atomic rebuild operations are invalid");
  }
  const migrations = validatePlan(plan);

  return sql.begin(async (transaction) => {
    const teardown = await rebuild(transaction);
    await fault("after-teardown", -1);
    for (const [index, migration] of migrations.entries()) {
      await transaction.unsafe(migration.getBody());
      await fault("after-migration", index);
      await transaction.unsafe(HISTORY_INSERT_SQL, [
        migration.version,
        migration.getSource(),
        migration.name,
      ]);
      await fault("after-history", index);
    }
    const history = await transaction.unsafe(HISTORY_VERIFY_SQL);
    if (
      history.length !== migrations.length ||
      history.some(
        (row, index) =>
          row.version !== migrations[index].version ||
          row.name !== migrations[index].name ||
          row.statement !== migrations[index].getSource(),
      )
    ) {
      throw new Error("Greenfield TEST atomic migration history is invalid");
    }
    await fault("before-final-check", migrations.length);
    const fingerprint = await assertClean(
      transaction,
      GREENFIELD_TARGET_VERSIONS,
    );
    await fault("after-final-check", migrations.length);
    return Object.freeze({
      removedMigrations: teardown.removedMigrations,
      ...fingerprint,
    });
  });
}

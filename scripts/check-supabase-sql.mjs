import { readFile, readdir } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";

const MIGRATION_NAME = /^\d{14}_[a-z0-9]+(?:_[a-z0-9]+)*\.sql$/;
const TEST_NAME = /^\d{3}_[a-z0-9]+(?:_[a-z0-9]+)*\.test\.sql$/;
const MAXIMUM_LINES = 300;

function countLines(sql) {
  return sql === "" ? 0 : sql.replace(/\n$/, "").split("\n").length;
}

function securityDefinerBlocks(sql) {
  return [
    ...sql.matchAll(
      /create(?:\s+or\s+replace)?\s+function\b[\s\S]*?\bas\s+\$\$[\s\S]*?\$\$\s*;/gi,
    ),
  ]
    .map((match) => match[0])
    .filter((block) => /security\s+definer/i.test(block));
}

function withoutLeadingComments(sql) {
  return sql
    .replace(/^\s*(?:--[^\n]*(?:\n|$)|\/\*[\s\S]*?\*\/\s*)*/u, "")
    .trim();
}

export function validateMigrationSql(filename, sql) {
  const errors = [];
  const normalized = sql.trim();
  const executable = withoutLeadingComments(sql);
  const lineCount = countLines(sql);

  if (!MIGRATION_NAME.test(filename)) {
    errors.push(
      "migration filename must use a 14-digit timestamp and snake_case",
    );
  }
  if (normalized === "") errors.push("migration must not be empty");
  if (lineCount > MAXIMUM_LINES) {
    errors.push(
      `migration has ${lineCount} lines; maximum is ${MAXIMUM_LINES}`,
    );
  }
  if (normalized !== "") {
    if (!/^begin\s*;/i.test(executable))
      errors.push("migration must begin a transaction");
    if (!/commit\s*;$/i.test(normalized))
      errors.push("migration must commit its transaction");
  }
  if (/create\s+table\s+(?:if\s+not\s+exists\s+)?public\./i.test(sql)) {
    errors.push(
      "business tables must not be created in the exposed public schema",
    );
  }
  if (
    /grant\s+(?:all|select|insert|update|delete)[\s\S]{0,240}\bto\s+(?:public|anon|authenticated|service_role)\b/i.test(
      sql,
    )
  ) {
    errors.push(
      "business data privileges must not be granted to Data API roles",
    );
  }
  if (
    /(?:grant\s+gioia_(?:mutator|migrator)\s+to|revoke\s+gioia_(?:mutator|migrator)\s+from)\s+current_user\b/i.test(
      sql,
    )
  ) {
    errors.push(
      "migration role switching must target the explicit postgres principal",
    );
  }
  if (/set\s+local\s+role\s+gioia_mutator\b/i.test(sql)) {
    const normalizedSql = sql.toLowerCase();
    const membershipRevoke = normalizedSql.lastIndexOf(
      "revoke gioia_mutator from postgres;",
    );
    const finalFunctionAcl = Math.max(
      normalizedSql.lastIndexOf("revoke all on function"),
      normalizedSql.lastIndexOf("grant execute on function"),
    );
    if (membershipRevoke < finalFunctionAcl) {
      errors.push(
        "mutator membership must remain until function ACL changes are complete",
      );
    }
  }
  if (/pg_catalog\.(?:coalesce|greatest|least|nullif)\s*\(/i.test(sql)) {
    errors.push(
      "SQL conditional forms must not be qualified as pg_catalog functions",
    );
  }

  for (const block of securityDefinerBlocks(sql)) {
    if (!/set\s+search_path\s*=\s*''/i.test(block)) {
      errors.push(
        "every SECURITY DEFINER function must set an empty search_path",
      );
    }
  }

  return errors;
}

export function validateDatabaseTestSql(filename, sql) {
  const errors = [];
  const normalized = sql.trim();
  const executable = withoutLeadingComments(sql);
  const lineCount = countLines(sql);
  const isPgTapSetup = filename === "000_0_pgtap_setup.test.sql";

  if (!TEST_NAME.test(filename)) {
    errors.push("database test filename must use NNN_snake_case.test.sql");
  }
  if (sql.trim() === "") errors.push("database test must not be empty");
  if (lineCount > MAXIMUM_LINES) {
    errors.push(
      `database test has ${lineCount} lines; maximum is ${MAXIMUM_LINES}`,
    );
  }
  if (!/\bplan\s*\(/i.test(sql))
    errors.push("database test must declare a pgTAP plan");
  if (!/\bfinish\s*\(\s*\)/i.test(sql))
    errors.push("database test must call finish()");
  if (normalized !== "" && !isPgTapSetup) {
    if (!/^begin\s*;/i.test(executable))
      errors.push("database test must begin a transaction");
    if (!/rollback\s*;$/i.test(normalized))
      errors.push("database test must roll back its transaction");
  }
  if (
    /set\s+local\s+role\s+app_runtime\b/i.test(sql) &&
    !/grant\s+app_runtime\s+to\s+postgres\s*;/i.test(sql)
  ) {
    errors.push(
      "runtime-role tests require a transaction-scoped postgres membership grant",
    );
  }
  if (
    /set\s+local\s+role\s+app_runtime\b/i.test(sql) &&
    !/grant\s+usage\s+on\s+schema\s+extensions\s+to\s+app_runtime\s*;/i.test(
      sql,
    )
  ) {
    errors.push(
      "runtime-role pgTAP tests require transaction-scoped extensions usage",
    );
  }
  if (
    /set\s+local\s+role\s+gioia_mutator\b/i.test(sql) &&
    !/grant\s+gioia_mutator\s+to\s+postgres\s*;/i.test(sql)
  ) {
    errors.push(
      "mutator-role tests require a transaction-scoped postgres membership grant",
    );
  }

  return errors;
}

async function validateDirectory(directory, validator) {
  const entries = (await readdir(directory, { withFileTypes: true }))
    .filter((entry) => entry.isFile() && entry.name.endsWith(".sql"))
    .sort((left, right) => left.name.localeCompare(right.name));
  const failures = [];

  for (const entry of entries) {
    const filePath = path.join(directory, entry.name);
    const sql = await readFile(filePath, "utf8");
    for (const error of validator(entry.name, sql)) {
      failures.push(`${path.relative(process.cwd(), filePath)}: ${error}`);
    }
  }

  if (entries.length === 0) {
    failures.push(
      `${path.relative(process.cwd(), directory)}: no SQL files found`,
    );
  }
  return failures;
}

export async function checkSupabaseSql(rootDirectory = process.cwd()) {
  const migrationDirectory = path.join(rootDirectory, "supabase", "migrations");
  const testDirectory = path.join(rootDirectory, "supabase", "tests");
  const failures = [
    ...(await validateDirectory(migrationDirectory, validateMigrationSql)),
    ...(await validateDirectory(testDirectory, validateDatabaseTestSql)),
  ];

  if (failures.length > 0) {
    throw new Error(`Supabase SQL validation failed:\n${failures.join("\n")}`);
  }
}

const isCli = process.argv[1] === fileURLToPath(import.meta.url);
if (isCli) {
  try {
    await checkSupabaseSql();
    process.stdout.write(
      "Supabase migrations and pgTAP files passed static validation.\n",
    );
  } catch (error) {
    process.stderr.write(
      `${error instanceof Error ? error.message : String(error)}\n`,
    );
    process.exitCode = 1;
  }
}

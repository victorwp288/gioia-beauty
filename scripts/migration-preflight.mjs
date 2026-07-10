import { pathToFileURL } from "node:url";
import { resolve } from "node:path";

import {
  MIGRATION_PREFLIGHT_CONTRACT_VERSION,
  MigrationArgumentError,
  evaluateMigrationPreflight,
  parseMigrationArguments,
} from "../lib/server/migrationPreflight.mjs";

function argumentFailure(error) {
  const known = error instanceof MigrationArgumentError;
  return Object.freeze({
    contractVersion: MIGRATION_PREFLIGHT_CONTRACT_VERSION,
    ok: false,
    error: Object.freeze({
      code: known ? error.code : "INVALID_ARGUMENTS",
      field: known ? error.field : null,
    }),
  });
}

export function runMigrationPreflightCli(argv, env = process.env) {
  try {
    const result = evaluateMigrationPreflight(
      parseMigrationArguments(argv),
      env,
    );
    return Object.freeze({
      exitCode: result.ok ? 0 : 2,
      stream: "stdout",
      output: `${JSON.stringify(result, null, 2)}\n`,
    });
  } catch (error) {
    return Object.freeze({
      exitCode: 2,
      stream: "stderr",
      output: `${JSON.stringify(argumentFailure(error))}\n`,
    });
  }
}

const invokedPath = process.argv[1]
  ? pathToFileURL(resolve(process.argv[1])).href
  : null;

if (import.meta.url === invokedPath) {
  const result = runMigrationPreflightCli(process.argv.slice(2));
  const writer = result.stream === "stdout" ? process.stdout : process.stderr;
  writer.write(result.output);
  process.exitCode = result.exitCode;
}

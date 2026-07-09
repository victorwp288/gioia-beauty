import {
  GREENFIELD_SUPABASE_REF,
  PRODUCTION_SUPABASE_REF,
} from "../../config/environment.mjs";

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const SHA256_PATTERN = /^[0-9a-f]{64}$/;
const VALUE_FLAGS = new Set([
  "environment",
  "target-project-ref",
  "source-project-id",
  "run-id",
  "expected-max-rows",
  "source-manifest-sha256",
  "confirm",
]);

export function parseMigrationArguments(argv) {
  const values = {};
  let apply = false;

  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (token === "--apply") {
      if (apply) throw new Error("Duplicate --apply flag");
      apply = true;
      continue;
    }
    if (!token?.startsWith("--")) {
      throw new Error(`Unexpected migration argument at position ${index + 1}`);
    }

    const name = token.slice(2);
    if (!VALUE_FLAGS.has(name)) throw new Error(`Unknown --${name} flag`);
    if (Object.hasOwn(values, name))
      throw new Error(`Duplicate --${name} flag`);

    const value = argv[index + 1];
    if (!value || value.startsWith("--")) {
      throw new Error(`--${name} requires a value`);
    }
    values[name] = value;
    index += 1;
  }

  return { ...values, apply };
}

function hasEvidence(env, name) {
  return typeof env[name] === "string" && env[name].trim().length >= 8;
}

export function migrationConfirmation(options) {
  return [
    "APPLY",
    options.environment,
    options["target-project-ref"],
    options["run-id"],
    options["expected-max-rows"],
    options["source-manifest-sha256"]?.slice(0, 12),
  ].join(":");
}

export function evaluateMigrationPreflight(
  options,
  env = process.env,
  registry = {
    test: GREENFIELD_SUPABASE_REF,
    production: PRODUCTION_SUPABASE_REF,
  },
) {
  const errors = [];
  const environment = options.environment;
  const target = options["target-project-ref"];
  const source = options["source-project-id"];
  const runId = options["run-id"];
  const maximumRows = Number(options["expected-max-rows"]);
  const manifestSha256 = options["source-manifest-sha256"];

  if (!new Set(["test", "production"]).has(environment)) {
    errors.push("environment must be test or production");
  }
  if (!registry[environment]) {
    errors.push(`no registered ${environment || "unknown"} migration target`);
  } else if (target !== registry[environment]) {
    errors.push("target project ref does not match the environment registry");
  }
  if (environment === "test" && source !== "synthetic-fixtures") {
    errors.push("TEST migrations require the synthetic-fixtures source");
  }
  if (environment === "production" && source !== "gioia-beauty-b95e0") {
    errors.push(
      "Production migration source must be the registered Firestore project",
    );
  }
  if (!UUID_PATTERN.test(runId || "")) errors.push("run id must be a UUID");
  if (
    !Number.isSafeInteger(maximumRows) ||
    maximumRows < 1 ||
    maximumRows > 100_000
  ) {
    errors.push("expected max rows must be an integer between 1 and 100000");
  }
  if (!SHA256_PATTERN.test(manifestSha256 || "")) {
    errors.push("source manifest SHA-256 must be 64 lowercase hex characters");
  }

  if (options.apply) {
    if (options.confirm !== migrationConfirmation(options)) {
      errors.push(
        "apply confirmation does not match the exact migration bounds",
      );
    }
    if (environment === "production") {
      for (const evidence of [
        "GIOIA_PRODUCTION_APPROVAL_ID",
        "MIGRATION_BACKUP_EVIDENCE_ID",
        "MIGRATION_RESTORE_EVIDENCE_ID",
        "MIGRATION_WRITE_FREEZE_ID",
      ]) {
        if (!hasEvidence(env, evidence)) errors.push(`${evidence} is required`);
      }
    }
  }

  return {
    ok: errors.length === 0,
    mode: options.apply ? "apply" : "dry-run",
    environment: environment || null,
    sourceProjectId: source || null,
    targetProjectRef: target || null,
    runId: runId || null,
    expectedMaxRows: Number.isSafeInteger(maximumRows) ? maximumRows : null,
    sourceManifestSha256: SHA256_PATTERN.test(manifestSha256 || "")
      ? manifestSha256.toLowerCase()
      : null,
    errors,
  };
}

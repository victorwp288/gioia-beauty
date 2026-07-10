import {
  GREENFIELD_SUPABASE_REF,
  PRODUCTION_SUPABASE_REF,
} from "../../config/environment.mjs";
import {
  SHA256_PATTERN,
  addError,
  exactPattern,
  requireInvariant,
} from "./migrationPreflightValidation.mjs";

export const MIGRATION_ACTIONS = Object.freeze([
  "inventory",
  "import",
  "reconcile",
]);
export const MIGRATION_ENVIRONMENTS = Object.freeze(["test", "production"]);
export const NUMBER_FIELDS = Object.freeze({
  "expected-source-rows": Object.freeze([1, 100_000]),
  "expected-imported-rows": Object.freeze([0, 100_000]),
  "expected-quarantined-rows": Object.freeze([0, 100_000]),
  "max-source-reads": Object.freeze([1, 100_000]),
  "max-target-reads": Object.freeze([0, 500_000]),
  "max-inserts": Object.freeze([0, 500_000]),
  "max-updates": Object.freeze([0, 500_000]),
  "max-deletes": Object.freeze([0, 0]),
  "max-quarantines": Object.freeze([0, 100_000]),
  "batch-size": Object.freeze([1, 500]),
  "max-batches": Object.freeze([1, 100_000]),
  "max-errors": Object.freeze([0, 0]),
  "max-duration-seconds": Object.freeze([1, 14_400]),
  "max-downtime-seconds": Object.freeze([0, 3_600]),
});
export const SOURCE_COLLECTIONS = Object.freeze([
  "analytics",
  "customers",
  "newsletter_subscribers",
  "settings",
  "vacations",
]);
export const TARGET_RELATIONS = Object.freeze([
  "domain_change_log",
  "migration_quarantine",
  "migration_records",
  "migration_runs",
  "newsletter_subscribers",
  "schedule_entries",
  "vacations",
]);

const PROJECT_REF_PATTERN = /^[a-z0-9]{20}$/;
const EVIDENCE_PLAN_KEYS = Object.freeze({
  "export-evidence-sha256": "exportSha256",
  "backup-evidence-sha256": "backupSha256",
  "restore-evidence-sha256": "restoreSha256",
  "write-freeze-evidence-sha256": "writeFreezeSha256",
  "rehearsal-evidence-sha256": "rehearsalSha256",
  "recovery-evidence-sha256": "recoverySha256",
});
const EVIDENCE_FIELDS = Object.freeze(Object.keys(EVIDENCE_PLAN_KEYS));

export function registeredTarget(environment, value, errors) {
  if (typeof value !== "string" || !PROJECT_REF_PATTERN.test(value)) {
    addError(errors, "INVALID_FIELD", "target-project-ref");
    return null;
  }
  const registered =
    environment === "test"
      ? GREENFIELD_SUPABASE_REF
      : environment === "production"
        ? PRODUCTION_SUPABASE_REF
        : null;
  if (!registered) {
    addError(errors, "TARGET_UNREGISTERED", "target-project-ref");
    return null;
  }
  if (value !== registered) {
    addError(errors, "TARGET_MISMATCH", "target-project-ref");
    return null;
  }
  return value;
}

export function sourceForEnvironment(environment, value, errors) {
  const expected =
    environment === "test"
      ? "synthetic-fixtures"
      : environment === "production"
        ? "gioia-beauty-b95e0"
        : null;
  if (!expected || value !== expected) {
    addError(errors, "SOURCE_MISMATCH", "source-project-id");
    return null;
  }
  return value;
}

export function evidenceForPlan(options, environment, action, errors) {
  const evidence = Object.fromEntries(
    Object.values(EVIDENCE_PLAN_KEYS).map((key) => [key, null]),
  );
  if (environment === "test") {
    for (const field of EVIDENCE_FIELDS) {
      if (Object.hasOwn(options, field)) {
        addError(errors, "UNEXPECTED_FIELD", field);
      }
    }
    return evidence;
  }

  const required =
    action === "inventory"
      ? ["export-evidence-sha256"]
      : EVIDENCE_FIELDS.filter((field) => field !== "export-evidence-sha256");
  for (const field of EVIDENCE_FIELDS) {
    const isRequired = required.includes(field);
    const value = exactPattern(
      options,
      field,
      SHA256_PATTERN,
      errors,
      isRequired,
    );
    if (!isRequired && value !== null) {
      addError(errors, "UNEXPECTED_FIELD", field);
    }
    evidence[EVIDENCE_PLAN_KEYS[field]] = value;
  }
  return evidence;
}

export function applyActionInvariants(
  action,
  artifacts,
  expected,
  bounds,
  errors,
) {
  const values = [...Object.values(expected), ...Object.values(bounds)];
  if (values.some((value) => value === null)) return;
  requireInvariant(
    bounds.maxSourceReads === expected.sourceRows,
    errors,
    "max-source-reads",
  );
  requireInvariant(
    bounds.maxBatches === Math.ceil(expected.sourceRows / bounds.batchSize),
    errors,
    "max-batches",
  );

  if (action === "inventory") {
    for (const [field, value] of [
      ["expected-imported-rows", expected.importedRows],
      ["expected-quarantined-rows", expected.quarantinedRows],
      ["max-target-reads", bounds.maxTargetReads],
      ["max-inserts", bounds.maxInserts],
      ["max-updates", bounds.maxUpdates],
      ["max-quarantines", bounds.maxQuarantines],
      ["max-downtime-seconds", bounds.maxDowntimeSeconds],
    ]) {
      requireInvariant(value === 0, errors, field);
    }
    return;
  }

  requireInvariant(
    expected.sourceRows === expected.importedRows + expected.quarantinedRows,
    errors,
    "expected-source-rows",
  );
  if (action === "import") {
    requireInvariant(
      bounds.maxQuarantines === expected.quarantinedRows,
      errors,
      "max-quarantines",
    );
    requireInvariant(
      bounds.maxInserts >= expected.sourceRows * 2 + 1,
      errors,
      "max-inserts",
    );
    requireInvariant(
      bounds.maxUpdates <= expected.sourceRows + 1,
      errors,
      "max-updates",
    );
    return;
  }

  for (const [field, value] of [
    ["max-inserts", bounds.maxInserts],
    ["max-updates", bounds.maxUpdates],
    ["max-quarantines", bounds.maxQuarantines],
    ["max-downtime-seconds", bounds.maxDowntimeSeconds],
  ]) {
    requireInvariant(value === 0, errors, field);
  }
}

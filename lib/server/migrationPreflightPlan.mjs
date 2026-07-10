import { createHash } from "node:crypto";

import {
  MIGRATION_ACTIONS,
  MIGRATION_ENVIRONMENTS,
  NUMBER_FIELDS,
  SOURCE_COLLECTIONS,
  TARGET_RELATIONS,
  applyActionInvariants,
  evidenceForPlan,
  registeredTarget,
  sourceForEnvironment,
} from "./migrationPreflightPolicy.mjs";
import {
  COMMIT_SHA_PATTERN,
  SHA256_PATTERN,
  UUID_PATTERN,
  addError,
  exactEnum,
  exactNumber,
  exactPattern,
} from "./migrationPreflightValidation.mjs";

export const MIGRATION_PREFLIGHT_CONTRACT_VERSION = 2;
const PLAN_HASH_CONTEXT = "gioia:migration-preflight:v2\0";
const ACTIONS = new Set(MIGRATION_ACTIONS);
const ENVIRONMENTS = new Set(MIGRATION_ENVIRONMENTS);

export function compileMigrationPlan(input) {
  const errors = [];
  const action = exactEnum(input, "action", ACTIONS, errors);
  const environment = exactEnum(input, "environment", ENVIRONMENTS, errors);
  const targetProjectRef = registeredTarget(
    environment,
    input["target-project-ref"],
    errors,
  );
  const sourceProjectId = sourceForEnvironment(
    environment,
    input["source-project-id"],
    errors,
  );
  const runId = exactPattern(input, "run-id", UUID_PATTERN, errors);
  const commitSha = exactPattern(
    input,
    "commit-sha",
    COMMIT_SHA_PATTERN,
    errors,
  );
  const artifacts = {
    executionManifestSha256: exactPattern(
      input,
      "execution-manifest-sha256",
      SHA256_PATTERN,
      errors,
    ),
    sourceManifestSha256: exactPattern(
      input,
      "source-manifest-sha256",
      SHA256_PATTERN,
      errors,
      action !== "inventory",
    ),
    reconciliationManifestSha256: exactPattern(
      input,
      "reconciliation-manifest-sha256",
      SHA256_PATTERN,
      errors,
      action !== "inventory",
    ),
    stopConditionsSha256: exactPattern(
      input,
      "stop-conditions-sha256",
      SHA256_PATTERN,
      errors,
    ),
    recoveryPlanSha256: exactPattern(
      input,
      "recovery-plan-sha256",
      SHA256_PATTERN,
      errors,
    ),
  };
  if (action === "inventory") {
    for (const field of [
      "source-manifest-sha256",
      "reconciliation-manifest-sha256",
    ]) {
      if (Object.hasOwn(input, field))
        addError(errors, "UNEXPECTED_FIELD", field);
    }
  }

  const numbers = {};
  for (const [field, [minimum, maximum]] of Object.entries(NUMBER_FIELDS)) {
    numbers[field] = exactNumber(input, field, minimum, maximum, errors);
  }
  const expected = {
    sourceRows: numbers["expected-source-rows"],
    importedRows: numbers["expected-imported-rows"],
    quarantinedRows: numbers["expected-quarantined-rows"],
  };
  const bounds = {
    maxSourceReads: numbers["max-source-reads"],
    maxTargetReads: numbers["max-target-reads"],
    maxInserts: numbers["max-inserts"],
    maxUpdates: numbers["max-updates"],
    maxDeletes: numbers["max-deletes"],
    maxQuarantines: numbers["max-quarantines"],
    batchSize: numbers["batch-size"],
    maxBatches: numbers["max-batches"],
    maxErrors: numbers["max-errors"],
    maxDurationSeconds: numbers["max-duration-seconds"],
    maxDowntimeSeconds: numbers["max-downtime-seconds"],
  };
  const evidence = evidenceForPlan(input, environment, action, errors);
  applyActionInvariants(action, artifacts, expected, bounds, errors);

  if (errors.length > 0) return { errors, plan: null, planSha256: null };
  const plan = {
    contractVersion: MIGRATION_PREFLIGHT_CONTRACT_VERSION,
    action,
    environment,
    targetProjectRef,
    sourceProjectId,
    runId,
    commitSha,
    sourceCollections: [...SOURCE_COLLECTIONS],
    targetRelations: [...TARGET_RELATIONS],
    artifacts,
    expected,
    bounds,
    evidence,
  };
  const planSha256 = createHash("sha256")
    .update(PLAN_HASH_CONTEXT, "utf8")
    .update(JSON.stringify(plan), "utf8")
    .digest("hex");
  return { errors, plan, planSha256 };
}

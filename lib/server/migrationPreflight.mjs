import {
  MigrationArgumentError,
  ownEnvironmentString,
  parseMigrationArguments,
  protectedEnvironmentState,
  snapshotMigrationOptions,
} from "./migrationPreflightInput.mjs";
import {
  MIGRATION_PREFLIGHT_CONTRACT_VERSION,
  compileMigrationPlan,
} from "./migrationPreflightPlan.mjs";
import {
  SHA256_PATTERN,
  UUID_PATTERN,
  addError,
  exactPattern,
  freezeDeep,
} from "./migrationPreflightValidation.mjs";

export {
  MIGRATION_PREFLIGHT_CONTRACT_VERSION,
  MigrationArgumentError,
  parseMigrationArguments,
};

function planConfirmation(plan, hash) {
  return [
    "GIOIA-MIGRATION-V2",
    "APPLY",
    plan.environment,
    plan.action,
    plan.targetProjectRef,
    plan.runId,
    hash,
  ].join(":");
}

function invalidOptionsResult() {
  return freezeDeep({
    contractVersion: MIGRATION_PREFLIGHT_CONTRACT_VERSION,
    ok: false,
    mode: null,
    plan: null,
    planSha256: null,
    applyConfirmation: null,
    confirmationMatched: null,
    errors: [{ code: "INVALID_OPTIONS", field: "options" }],
  });
}

function validateApply(input, env, compiled) {
  const { errors, plan, planSha256 } = compiled;
  if (ownEnvironmentString(env, "APP_ENV") !== "operator") {
    addError(errors, "OPERATOR_ENVIRONMENT_REQUIRED", "APP_ENV");
  }
  const declaredPlan = exactPattern(
    input,
    "plan-sha256",
    SHA256_PATTERN,
    errors,
  );
  const confirm = input.confirm;
  if (typeof confirm !== "string")
    addError(errors, "REQUIRED_FIELD", "confirm");

  let matched = false;
  if (plan && planSha256) {
    matched =
      declaredPlan === planSha256 &&
      confirm === planConfirmation(plan, planSha256);
    if (!matched) addError(errors, "CONFIRMATION_MISMATCH", "confirm");
  }

  if (plan?.environment === "production") {
    const approvalId = ownEnvironmentString(
      env,
      "GIOIA_PRODUCTION_APPROVAL_ID",
    );
    const approvalPlan = ownEnvironmentString(
      env,
      "GIOIA_PRODUCTION_APPROVAL_PLAN_SHA256",
    );
    if (!approvalId || !UUID_PATTERN.test(approvalId)) {
      addError(errors, "PRODUCTION_APPROVAL_REQUIRED", "approval");
    }
    if (!planSha256 || approvalPlan !== planSha256) {
      addError(errors, "PRODUCTION_APPROVAL_MISMATCH", "approval");
    }
  } else if (
    ownEnvironmentString(env, "GIOIA_PRODUCTION_APPROVAL_ID") !== null ||
    ownEnvironmentString(env, "GIOIA_PRODUCTION_APPROVAL_PLAN_SHA256") !== null
  ) {
    addError(errors, "UNEXPECTED_ENVIRONMENT_EVIDENCE", "approval");
  }
  return matched;
}

function rejectCredentialEnvironment(env, errors) {
  const state = protectedEnvironmentState(env);
  if (state === null) {
    addError(errors, "INVALID_ENVIRONMENT", "environment");
  } else if (state) {
    addError(errors, "CREDENTIALS_PRESENT", "environment");
  }
}

/**
 * Compiles and binds an inert plan. It never verifies evidence, opens a
 * connection, calls a provider, or authorizes a production action by itself.
 */
export function evaluateMigrationPreflight(options, env = process.env) {
  const input = snapshotMigrationOptions(options);
  if (!input) return invalidOptionsResult();

  try {
    const compiled = compileMigrationPlan(input);
    const { errors, plan, planSha256 } = compiled;
    rejectCredentialEnvironment(env, errors);
    let confirmationFieldsMatched = null;
    if (input.apply) {
      confirmationFieldsMatched = validateApply(input, env, compiled);
    } else {
      if (Object.hasOwn(input, "plan-sha256")) {
        addError(errors, "UNEXPECTED_FIELD", "plan-sha256");
      }
      if (Object.hasOwn(input, "confirm")) {
        addError(errors, "UNEXPECTED_FIELD", "confirm");
      }
    }
    const applyConfirmation =
      !input.apply && errors.length === 0 && plan && planSha256
        ? planConfirmation(plan, planSha256)
        : null;
    const ok = errors.length === 0;
    const confirmationMatched = input.apply
      ? ok && confirmationFieldsMatched === true
      : null;
    return freezeDeep({
      contractVersion: MIGRATION_PREFLIGHT_CONTRACT_VERSION,
      ok,
      mode: input.apply ? "apply" : "dry-run",
      plan,
      planSha256,
      applyConfirmation,
      confirmationMatched,
      errors,
    });
  } catch {
    return invalidOptionsResult();
  }
}

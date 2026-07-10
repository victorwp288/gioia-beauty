import { GREENFIELD_SUPABASE_REF } from "@/config/environment.mjs";

export const RUN_ID = "018f5f50-a48b-7f3c-8b28-55f43fd91df0";
export const COMMIT_SHA = "1".repeat(40);
export const HASHES = Object.freeze({
  execution: "a".repeat(64),
  source: "b".repeat(64),
  reconciliation: "c".repeat(64),
  stop: "d".repeat(64),
  recovery: "e".repeat(64),
});

const SHARED_OPTIONS = Object.freeze({
  environment: "test",
  "target-project-ref": GREENFIELD_SUPABASE_REF,
  "source-project-id": "synthetic-fixtures",
  "run-id": RUN_ID,
  "commit-sha": COMMIT_SHA,
  "execution-manifest-sha256": HASHES.execution,
  "stop-conditions-sha256": HASHES.stop,
  "recovery-plan-sha256": HASHES.recovery,
  "expected-source-rows": "2000",
  "max-source-reads": "2000",
  "batch-size": "500",
  "max-batches": "4",
  "max-errors": "0",
  "max-duration-seconds": "3600",
  "max-deletes": "0",
});

export const VALID_INVENTORY_OPTIONS = Object.freeze({
  action: "inventory",
  ...SHARED_OPTIONS,
  "expected-imported-rows": "0",
  "expected-quarantined-rows": "0",
  "max-target-reads": "0",
  "max-inserts": "0",
  "max-updates": "0",
  "max-quarantines": "0",
  "max-downtime-seconds": "0",
  apply: false,
});

export const VALID_IMPORT_OPTIONS = Object.freeze({
  action: "import",
  ...SHARED_OPTIONS,
  "source-manifest-sha256": HASHES.source,
  "reconciliation-manifest-sha256": HASHES.reconciliation,
  "expected-imported-rows": "1990",
  "expected-quarantined-rows": "10",
  "max-target-reads": "5000",
  "max-inserts": "5000",
  "max-updates": "100",
  "max-quarantines": "10",
  "max-downtime-seconds": "600",
  apply: false,
});

export const VALID_RECONCILE_OPTIONS = Object.freeze({
  action: "reconcile",
  ...SHARED_OPTIONS,
  "source-manifest-sha256": HASHES.source,
  "reconciliation-manifest-sha256": HASHES.reconciliation,
  "expected-imported-rows": "1990",
  "expected-quarantined-rows": "10",
  "max-target-reads": "5000",
  "max-inserts": "0",
  "max-updates": "0",
  "max-quarantines": "0",
  "max-downtime-seconds": "0",
  apply: false,
});

export const OPERATOR_ENVIRONMENT = Object.freeze({ APP_ENV: "operator" });

export function optionsToArgv(options) {
  const argv = [];
  for (const [name, value] of Object.entries(options)) {
    if (name === "apply") continue;
    argv.push(`--${name}`, value);
  }
  if (options.apply) argv.push("--apply");
  return argv;
}

export function applyOptions(options, dryRun) {
  return {
    ...options,
    apply: true,
    "plan-sha256": dryRun.planSha256,
    confirm: dryRun.applyConfirmation,
  };
}

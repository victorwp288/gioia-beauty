import { describe, expect, it } from "vitest";

import {
  MIGRATION_PREFLIGHT_CONTRACT_VERSION,
  evaluateMigrationPreflight,
  parseMigrationArguments,
} from "@/lib/server/migrationPreflight.mjs";

import {
  COMMIT_SHA,
  HASHES,
  OPERATOR_ENVIRONMENT,
  RUN_ID,
  VALID_IMPORT_OPTIONS,
  VALID_INVENTORY_OPTIONS,
  VALID_RECONCILE_OPTIONS,
  applyOptions,
  optionsToArgv,
} from "./migration-preflight-fixture.js";

describe("migration preflight v2 plan compiler", () => {
  it("compiles a bounded inventory dry run and full-hash confirmation", () => {
    const result = evaluateMigrationPreflight(VALID_INVENTORY_OPTIONS);

    expect(result).toMatchObject({
      contractVersion: 2,
      ok: true,
      mode: "dry-run",
      confirmationMatched: null,
      errors: [],
      plan: {
        contractVersion: 2,
        action: "inventory",
        environment: "test",
        sourceProjectId: "synthetic-fixtures",
        runId: RUN_ID,
        commitSha: COMMIT_SHA,
        artifacts: {
          executionManifestSha256: HASHES.execution,
          sourceManifestSha256: null,
          reconciliationManifestSha256: null,
          stopConditionsSha256: HASHES.stop,
          recoveryPlanSha256: HASHES.recovery,
        },
        expected: { sourceRows: 2000, importedRows: 0, quarantinedRows: 0 },
        bounds: {
          maxSourceReads: 2000,
          maxTargetReads: 0,
          maxInserts: 0,
          maxUpdates: 0,
          maxDeletes: 0,
          maxQuarantines: 0,
          batchSize: 500,
          maxBatches: 4,
          maxErrors: 0,
          maxDurationSeconds: 3600,
          maxDowntimeSeconds: 0,
        },
        sourceCollections: [
          "analytics",
          "customers",
          "newsletter_subscribers",
          "settings",
          "vacations",
        ],
        targetRelations: [
          "domain_change_log",
          "migration_quarantine",
          "migration_records",
          "migration_runs",
          "newsletter_subscribers",
          "schedule_entries",
          "vacations",
        ],
      },
    });
    expect(result.planSha256).toBe(
      "dad7d695092394a8f390226422d43f9b81384a7e94a7de1676b8e60c7532da5f",
    );
    expect(result.applyConfirmation).toBe(
      "GIOIA-MIGRATION-V2:APPLY:test:inventory:lxvsspniipcotimbsfqm:018f5f50-a48b-7f3c-8b28-55f43fd91df0:dad7d695092394a8f390226422d43f9b81384a7e94a7de1676b8e60c7532da5f",
    );
    expect(MIGRATION_PREFLIGHT_CONTRACT_VERSION).toBe(2);
  });

  it.each([
    ["import", VALID_IMPORT_OPTIONS],
    ["reconcile", VALID_RECONCILE_OPTIONS],
  ])("compiles the bounded %s action", (_action, options) => {
    const result = evaluateMigrationPreflight(options);
    expect(result.ok).toBe(true);
    expect(result.plan.expected).toEqual({
      sourceRows: 2000,
      importedRows: 1990,
      quarantinedRows: 10,
    });
    expect(result.plan.artifacts).toMatchObject({
      sourceManifestSha256: HASHES.source,
      reconciliationManifestSha256: HASHES.reconciliation,
    });
  });

  it("accepts only the exact dry-run plan as an operator apply", () => {
    const dryRun = evaluateMigrationPreflight(VALID_IMPORT_OPTIONS);
    const applied = evaluateMigrationPreflight(
      applyOptions(VALID_IMPORT_OPTIONS, dryRun),
      OPERATOR_ENVIRONMENT,
    );

    expect(applied).toMatchObject({
      ok: true,
      mode: "apply",
      planSha256: dryRun.planSha256,
      applyConfirmation: null,
      confirmationMatched: true,
      errors: [],
    });
  });

  it("parses the complete exact CLI surface without coercion", () => {
    const parsed = parseMigrationArguments(optionsToArgv(VALID_IMPORT_OPTIONS));
    expect(parsed).toEqual(VALID_IMPORT_OPTIONS);
    expect(Object.isFrozen(parsed)).toBe(true);
  });

  it("binds every operational field to the plan hash", () => {
    const baseline = evaluateMigrationPreflight(VALID_IMPORT_OPTIONS);
    const changes = [
      { "run-id": "018f5f50-a48b-7f3c-9b28-55f43fd91df0" },
      { "commit-sha": "2".repeat(40) },
      { "execution-manifest-sha256": "f".repeat(64) },
      { "source-manifest-sha256": `${HASHES.source.slice(0, 63)}c` },
      { "stop-conditions-sha256": "f".repeat(64) },
      { "recovery-plan-sha256": "f".repeat(64) },
      { "max-target-reads": "5001" },
      { "max-duration-seconds": "3601" },
      { "max-downtime-seconds": "601" },
    ];
    for (const change of changes) {
      const changed = evaluateMigrationPreflight({
        ...VALID_IMPORT_OPTIONS,
        ...change,
      });
      expect(changed.ok).toBe(true);
      expect(changed.planSha256).not.toBe(baseline.planSha256);
      expect(changed.applyConfirmation).not.toBe(baseline.applyConfirmation);
    }
  });

  it("keeps Production disabled without injectable registry authority", () => {
    const options = {
      ...VALID_IMPORT_OPTIONS,
      environment: "production",
      "target-project-ref": "abcdefghijklmnopqrst",
      "source-project-id": "gioia-beauty-b95e0",
      "backup-evidence-sha256": "1".repeat(64),
      "restore-evidence-sha256": "2".repeat(64),
      "write-freeze-evidence-sha256": "3".repeat(64),
      "rehearsal-evidence-sha256": "4".repeat(64),
      "recovery-evidence-sha256": "5".repeat(64),
    };
    const result = evaluateMigrationPreflight(
      options,
      {
        APP_ENV: "operator",
        GIOIA_PRODUCTION_APPROVAL_ID: RUN_ID,
        GIOIA_PRODUCTION_APPROVAL_PLAN_SHA256: "a".repeat(64),
      },
      { production: "abcdefghijklmnopqrst" },
    );

    expect(result.ok).toBe(false);
    expect(result.plan).toBeNull();
    expect(result.planSha256).toBeNull();
    expect(result.applyConfirmation).toBeNull();
    expect(result.errors).toContainEqual({
      code: "TARGET_UNREGISTERED",
      field: "target-project-ref",
    });
  });

  it("returns deeply immutable plans and fixed errors", () => {
    const valid = evaluateMigrationPreflight(VALID_IMPORT_OPTIONS);
    const invalid = evaluateMigrationPreflight({
      ...VALID_IMPORT_OPTIONS,
      "commit-sha": "private-sentinel",
    });

    expect(Object.isFrozen(valid)).toBe(true);
    expect(Object.isFrozen(valid.plan)).toBe(true);
    expect(Object.isFrozen(valid.plan.bounds)).toBe(true);
    expect(Object.isFrozen(valid.plan.sourceCollections)).toBe(true);
    expect(invalid.plan).toBeNull();
    expect(invalid.applyConfirmation).toBeNull();
    expect(JSON.stringify(invalid)).not.toContain("private-sentinel");
  });
});

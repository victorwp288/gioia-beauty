import { describe, expect, it } from "vitest";

import { GREENFIELD_SUPABASE_REF } from "@/config/environment.mjs";
import {
  evaluateMigrationPreflight,
  migrationConfirmation,
  parseMigrationArguments,
} from "@/lib/server/migrationPreflight.mjs";

const validTestOptions = {
  environment: "test",
  "target-project-ref": GREENFIELD_SUPABASE_REF,
  "source-project-id": "synthetic-fixtures",
  "run-id": "018f5f50-a48b-7f3c-8b28-55f43fd91df0",
  "expected-max-rows": "2000",
  "source-manifest-sha256": "a".repeat(64),
  apply: false,
};

describe("migration preflight", () => {
  it("defaults a bounded TEST operation to dry-run", () => {
    expect(evaluateMigrationPreflight(validTestOptions)).toMatchObject({
      ok: true,
      mode: "dry-run",
      targetProjectRef: GREENFIELD_SUPABASE_REF,
      expectedMaxRows: 2000,
      errors: [],
    });
  });

  it("requires an exact target and exact apply confirmation", () => {
    const apply = { ...validTestOptions, apply: true, confirm: "wrong" };
    expect(evaluateMigrationPreflight(apply).errors).toContain(
      "apply confirmation does not match the exact migration bounds",
    );

    apply.confirm = migrationConfirmation(apply);
    expect(evaluateMigrationPreflight(apply).ok).toBe(true);
  });

  it("keeps Production disabled while no target is registered", () => {
    const production = {
      ...validTestOptions,
      environment: "production",
      "source-project-id": "gioia-beauty-b95e0",
      apply: true,
    };
    production.confirm = migrationConfirmation(production);

    const result = evaluateMigrationPreflight(production, {
      GIOIA_PRODUCTION_APPROVAL_ID: "approval-evidence",
      MIGRATION_BACKUP_EVIDENCE_ID: "backup-evidence",
      MIGRATION_RESTORE_EVIDENCE_ID: "restore-evidence",
      MIGRATION_WRITE_FREEZE_ID: "freeze-evidence",
    });

    expect(result.ok).toBe(false);
    expect(result.errors).toContain(
      "no registered production migration target",
    );
  });

  it("rejects missing evidence for a registered Production target", () => {
    const production = {
      ...validTestOptions,
      environment: "production",
      "target-project-ref": "registered-production-ref",
      "source-project-id": "gioia-beauty-b95e0",
      apply: true,
    };
    production.confirm = migrationConfirmation(production);

    const result = evaluateMigrationPreflight(
      production,
      {},
      {
        test: GREENFIELD_SUPABASE_REF,
        production: "registered-production-ref",
      },
    );

    expect(result.ok).toBe(false);
    expect(result.errors).toEqual(
      expect.arrayContaining([
        "GIOIA_PRODUCTION_APPROVAL_ID is required",
        "MIGRATION_BACKUP_EVIDENCE_ID is required",
        "MIGRATION_RESTORE_EVIDENCE_ID is required",
        "MIGRATION_WRITE_FREEZE_ID is required",
      ]),
    );
  });

  it("rejects unknown, duplicate, and unbounded arguments", () => {
    expect(() => parseMigrationArguments(["--unknown", "value"])).toThrow(
      "Unknown --unknown flag",
    );
    expect(() =>
      parseMigrationArguments([
        "--environment",
        "test",
        "--environment",
        "test",
      ]),
    ).toThrow("Duplicate --environment flag");

    const result = evaluateMigrationPreflight({
      ...validTestOptions,
      "expected-max-rows": "100001",
      "source-manifest-sha256": "not-a-hash",
    });
    expect(result.ok).toBe(false);
  });
});

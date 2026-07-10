import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

import { PRODUCTION_SUPABASE_REF } from "@/config/environment.mjs";
import {
  MIGRATION_ACTIONS,
  NUMBER_FIELDS,
} from "@/lib/server/migrationPreflightPolicy.mjs";

const ROOT = process.cwd();

function source(path) {
  return readFileSync(resolve(ROOT, path), "utf8");
}

describe("migration preflight source contract", () => {
  it("keeps code-owned actions aligned with the database ledger", () => {
    const migration = source(
      "supabase/migrations/20260709235627_add_migration_record_ledger.sql",
    );
    expect(MIGRATION_ACTIONS).toEqual(["inventory", "import", "reconcile"]);
    expect(Object.isFrozen(MIGRATION_ACTIONS)).toBe(true);
    expect(migration).toContain(
      "run_kind in ('inventory', 'import', 'reconcile')",
    );
  });

  it("makes every quantitative policy bound immutable", () => {
    expect(Object.isFrozen(NUMBER_FIELDS)).toBe(true);
    for (const bounds of Object.values(NUMBER_FIELDS)) {
      expect(Object.isFrozen(bounds)).toBe(true);
    }
    expect(Reflect.set(NUMBER_FIELDS["max-deletes"], "1", 1000)).toBe(false);
  });

  it("remains a pure plan compiler with Production unregistered", () => {
    const implementation = [
      "migrationPreflight.mjs",
      "migrationPreflightInput.mjs",
      "migrationPreflightPlan.mjs",
      "migrationPreflightPolicy.mjs",
      "migrationPreflightValidation.mjs",
    ]
      .map((file) => source(`lib/server/${file}`))
      .join("\n");

    expect(PRODUCTION_SUPABASE_REF).toBeNull();
    for (const forbidden of [
      'from "postgres"',
      'from "node:child_process"',
      "fetch(",
      "process.stdout",
      "process.stderr",
      "execCommand",
    ]) {
      expect(implementation).not.toContain(forbidden);
    }
  });
});

import { describe, expect, it, vi } from "vitest";

import {
  GREENFIELD_HISTORY_VERIFY_SQL,
  planGreenfieldAtomicRebuild,
} from "../../scripts/test-target-atomic-rebuild.mjs";
import {
  GREENFIELD_BOOTSTRAP_HISTORY_INSERT_SQL,
  GREENFIELD_BOOTSTRAP_HISTORY_SCHEMA_SQL,
  GREENFIELD_BOOTSTRAP_INSPECT_SQL,
  GREENFIELD_PRISTINE_BASELINE_GUARD_SQL,
  GREENFIELD_REFERENCE_ROW_COUNT,
  bootstrapGreenfieldTestProject,
} from "../../scripts/test-target-bootstrap.mjs";
import {
  GREENFIELD_EXPECTED_ROLE_NAMES,
  GREENFIELD_EXPECTED_SCHEMA_NAMES,
} from "../../scripts/test-target-fixtures.mjs";
import { GREENFIELD_TARGET_VERSIONS } from "../../scripts/test-target-migrations.mjs";
import {
  GREENFIELD_PRISTINE_BASELINE_EVIDENCE,
  GREENFIELD_PRISTINE_BASELINE_EVIDENCE_SQL,
  assertGreenfieldPristineBaselineEvidence,
} from "../../scripts/test-target-pristine-manifest-sql.mjs";

const fingerprint = {
  referenceChecksum: "a".repeat(64),
  schemaFingerprint: "b".repeat(64),
};

function pristineEvidence(overrides = {}) {
  return {
    catalog_fingerprint:
      GREENFIELD_PRISTINE_BASELINE_EVIDENCE.catalogFingerprint,
    manifest_rows: GREENFIELD_PRISTINE_BASELINE_EVIDENCE.manifestRows,
    role_count: GREENFIELD_PRISTINE_BASELINE_EVIDENCE.roleCount,
    membership_count: GREENFIELD_PRISTINE_BASELINE_EVIDENCE.membershipCount,
    schema_count: GREENFIELD_PRISTINE_BASELINE_EVIDENCE.schemaCount,
    extension_count: GREENFIELD_PRISTINE_BASELINE_EVIDENCE.extensionCount,
    relation_count: GREENFIELD_PRISTINE_BASELINE_EVIDENCE.relationCount,
    routine_count: GREENFIELD_PRISTINE_BASELINE_EVIDENCE.routineCount,
    trigger_count: GREENFIELD_PRISTINE_BASELINE_EVIDENCE.triggerCount,
    policy_count: GREENFIELD_PRISTINE_BASELINE_EVIDENCE.policyCount,
    standalone_type_count:
      GREENFIELD_PRISTINE_BASELINE_EVIDENCE.standaloneTypeCount,
    default_acl_count: GREENFIELD_PRISTINE_BASELINE_EVIDENCE.defaultAclCount,
    ...overrides,
  };
}

function exactHistory(plan) {
  return plan.getMigrations().map((migration) => ({
    name: migration.name,
    statement: migration.getSource(),
    version: migration.version,
  }));
}

function database(plan, migrationCount, { history } = {}) {
  const appliedHistory = exactHistory(plan);
  const managedHistory =
    history ??
    (migrationCount <= plan.migrationCount
      ? appliedHistory.slice(0, migrationCount)
      : [
          ...appliedHistory,
          {
            name: "foreign",
            statement: "select 'foreign';",
            version: "99999999999999",
          },
        ]);
  const state = { committed: false };
  const transaction = {
    unsafe: vi.fn(async (query) => {
      if (query === GREENFIELD_PRISTINE_BASELINE_EVIDENCE_SQL) {
        return [pristineEvidence()];
      }
      if (query === GREENFIELD_HISTORY_VERIFY_SQL) return appliedHistory;
      return [];
    }),
  };
  const sql = {
    unsafe: vi.fn(async (query) => {
      if (query === GREENFIELD_BOOTSTRAP_INSPECT_SQL) {
        return [{ history_exists: migrationCount !== 0 }];
      }
      if (query === GREENFIELD_HISTORY_VERIFY_SQL) return managedHistory;
      return [];
    }),
    begin: vi.fn(async (callback) => {
      const value = await callback(transaction);
      state.committed = true;
      return value;
    }),
  };
  return { sql, state, transaction };
}

describe("greenfield TEST pristine hosted bootstrap", () => {
  it("pins the hosted baseline, advisory lock, zero residue, and 205 references", () => {
    expect(GREENFIELD_REFERENCE_ROW_COUNT).toBe(205);
    expect(GREENFIELD_PRISTINE_BASELINE_GUARD_SQL).toContain(
      "pg_try_advisory_xact_lock(7102026, 72135538)",
    );
    expect(GREENFIELD_PRISTINE_BASELINE_GUARD_SQL).toContain(
      "current_user <> 'postgres'",
    );
    expect(GREENFIELD_BOOTSTRAP_INSPECT_SQL).toContain(
      "c.relname='schema_migrations'",
    );
    expect(GREENFIELD_PRISTINE_BASELINE_GUARD_SQL).toContain(
      "hosted baseline catalog is not pristine",
    );
    expect(GREENFIELD_PRISTINE_BASELINE_GUARD_SQL).toContain(
      "pristine Auth state is not empty",
    );
    expect(GREENFIELD_PRISTINE_BASELINE_GUARD_SQL).toContain(
      "pristine Storage state is not empty",
    );
    for (const role of GREENFIELD_EXPECTED_ROLE_NAMES.filter(
      (name) => !name.startsWith("gioia_") && name !== "app_runtime",
    )) {
      expect(GREENFIELD_PRISTINE_BASELINE_GUARD_SQL).toContain(`'${role}'`);
    }
    for (const schema of GREENFIELD_EXPECTED_SCHEMA_NAMES.filter(
      (name) => name !== "gioia_private" && name !== "supabase_migrations",
    )) {
      expect(GREENFIELD_PRISTINE_BASELINE_GUARD_SQL).toContain(`'${schema}'`);
    }
  });

  it("fingerprints the complete hosted provider catalog instead of name-only state", () => {
    for (const fragment of [
      "'database_acl'",
      "'database_setting'",
      "'role'",
      "'role_membership'",
      "'schema_acl'",
      "'default_acl'",
      "'extension'",
      "'relation_acl'",
      "'column_acl'",
      "'constraint'",
      "'index'",
      "'view'",
      "'sequence'",
      "'routine_acl'",
      "'trigger'",
      "'policy'",
      "'standalone_type'",
      "'type_acl'",
      "'event_trigger'",
      "'publication'",
    ]) {
      expect(GREENFIELD_PRISTINE_BASELINE_EVIDENCE_SQL).toContain(fragment);
    }
    expect(GREENFIELD_PRISTINE_BASELINE_EVIDENCE_SQL).toContain(
      "case when a.rolpassword is null then 'none'",
    );
    expect(GREENFIELD_PRISTINE_BASELINE_EVIDENCE_SQL).toContain(
      "extensions.digest",
    );
    expect(GREENFIELD_PRISTINE_BASELINE_EVIDENCE_SQL).not.toContain(
      "a.rolpassword,",
    );
  });

  it("pins the live PG17 hosted baseline hash and every aggregate bound", () => {
    expect(assertGreenfieldPristineBaselineEvidence(pristineEvidence())).toBe(
      true,
    );
    for (const override of [
      { catalog_fingerprint: "f".repeat(64) },
      { manifest_rows: 2650 },
      { role_count: 31 },
      { membership_count: 22 },
      { schema_count: 10 },
      { extension_count: 6 },
      { relation_count: 160 },
      { routine_count: 99 },
      { trigger_count: 6 },
      { policy_count: 1 },
      { standalone_type_count: 13 },
      { default_acl_count: 301 },
    ]) {
      expect(() =>
        assertGreenfieldPristineBaselineEvidence(pristineEvidence(override)),
      ).toThrow("provider catalog is not pristine");
    }
  });

  it("atomically applies all 63 reviewed migrations before accepting clean state", async () => {
    const plan = planGreenfieldAtomicRebuild();
    const target = database(plan, 0);
    const assertClean = vi.fn(async (_sql, versions) => {
      expect(versions).toEqual(GREENFIELD_TARGET_VERSIONS);
      return fingerprint;
    });

    await expect(
      bootstrapGreenfieldTestProject(target.sql, plan, { assertClean }),
    ).resolves.toEqual({
      bootstrapped: true,
      migrationCount: 63,
      referenceRows: 205,
      ...fingerprint,
    });

    expect(target.sql.begin).toHaveBeenCalledOnce();
    expect(target.state.committed).toBe(true);
    expect(assertClean).toHaveBeenCalledOnce();
    expect(target.transaction.unsafe).toHaveBeenCalledWith(
      GREENFIELD_PRISTINE_BASELINE_EVIDENCE_SQL,
    );
    expect(target.transaction.unsafe).toHaveBeenCalledWith(
      GREENFIELD_PRISTINE_BASELINE_GUARD_SQL,
    );
    for (const statement of GREENFIELD_BOOTSTRAP_HISTORY_SCHEMA_SQL) {
      expect(target.transaction.unsafe).toHaveBeenCalledWith(statement);
    }
    expect(
      target.transaction.unsafe.mock.calls.filter(
        ([query]) => query === GREENFIELD_BOOTSTRAP_HISTORY_INSERT_SQL,
      ),
    ).toHaveLength(63);
    expect(target.transaction.unsafe).toHaveBeenCalledWith(
      GREENFIELD_HISTORY_VERIFY_SQL,
    );
  });

  it("accepts an interrupted exact bootstrap without applying migrations again", async () => {
    const plan = planGreenfieldAtomicRebuild();
    const target = database(plan, GREENFIELD_TARGET_VERSIONS.length);
    const assertClean = vi.fn(async () => fingerprint);

    await expect(
      bootstrapGreenfieldTestProject(target.sql, plan, { assertClean }),
    ).resolves.toEqual({
      bootstrapped: false,
      migrationCount: 63,
      referenceRows: 205,
      ...fingerprint,
    });
    expect(target.sql.begin).not.toHaveBeenCalled();
    expect(target.sql.unsafe).toHaveBeenCalledWith(
      GREENFIELD_HISTORY_VERIFY_SQL,
    );
    expect(assertClean).toHaveBeenCalledOnce();
  });

  it.each([1, 35, 62, 64])(
    "rejects partial or foreign migration history count %i",
    async (migrationCount) => {
      const plan = planGreenfieldAtomicRebuild();
      const target = database(plan, migrationCount);
      await expect(
        bootstrapGreenfieldTestProject(target.sql, plan),
      ).rejects.toThrow("migration history is invalid");
      expect(target.sql.begin).not.toHaveBeenCalled();
    },
  );

  it("rejects altered managed history before the two-cycle flow", async () => {
    const plan = planGreenfieldAtomicRebuild();
    const history = exactHistory(plan);
    history[62] = { ...history[62], statement: "select 'foreign';" };
    const target = database(plan, 63, { history });
    await expect(
      bootstrapGreenfieldTestProject(target.sql, plan),
    ).rejects.toThrow("migration history is invalid");
    expect(target.sql.begin).not.toHaveBeenCalled();
  });

  it.each([
    ["after-pristine-guard", -1],
    ["after-history-schema", -1],
    ["after-migration", 0],
    ["after-history", 62],
    ["before-bootstrap-check", 63],
    ["after-bootstrap-check", 63],
  ])("rolls back a bootstrap fault at %s/%i", async (stage, index) => {
    const plan = planGreenfieldAtomicRebuild();
    const target = database(plan, 0);
    const failure = new Error(`synthetic ${stage}`);
    const fault = vi.fn(async (actualStage, actualIndex) => {
      if (actualStage === stage && actualIndex === index) throw failure;
    });
    await expect(
      bootstrapGreenfieldTestProject(target.sql, plan, {
        assertClean: async () => fingerprint,
        fault,
      }),
    ).rejects.toBe(failure);
    expect(target.state.committed).toBe(false);
  });
});

import { createHash } from "node:crypto";

import { describe, expect, it, vi } from "vitest";

import {
  GREENFIELD_HISTORY_INSERT_SQL,
  GREENFIELD_HISTORY_VERIFY_SQL,
  planGreenfieldAtomicRebuild,
  rebuildGreenfieldTestAtomically,
} from "../../scripts/test-target-atomic-rebuild.mjs";
import { GREENFIELD_TARGET_VERSIONS } from "../../scripts/test-target-migrations.mjs";
import { REVIEWED_MIGRATION_DIGESTS } from "../../scripts/test-target-reviewed-manifest.mjs";
import { GREENFIELD_REBUILD_RUNTIME_PRESERVATION_SQL } from "../../scripts/test-target-rebuild-sql.mjs";

const fingerprint = {
  referenceChecksum: "a".repeat(64),
  schemaFingerprint: "b".repeat(64),
};

function exactHistory(plan) {
  return plan.getMigrations().map((migration) => ({
    name: migration.name,
    statement: migration.getSource(),
    version: migration.version,
  }));
}

function database(plan, { history = exactHistory(plan) } = {}) {
  const unsafe = vi.fn(async (query) => {
    if (query === GREENFIELD_HISTORY_VERIFY_SQL) return history;
    if (query === GREENFIELD_REBUILD_RUNTIME_PRESERVATION_SQL) {
      return [{ runtime_role_preserved: true }];
    }
    return [];
  });
  const state = { committed: false };
  const begin = vi.fn(async (callback) => {
    const result = await callback({ unsafe });
    state.committed = true;
    return result;
  });
  return { begin, state, unsafe };
}

function operations(fault = async () => {}) {
  const operations = {
    assertClean: vi.fn(async (_transaction, versions) => {
      expect(versions).toEqual(GREENFIELD_TARGET_VERSIONS);
      return fingerprint;
    }),
    fault,
    rebuild: vi.fn(async (transaction, assertManagedState) => {
      await assertManagedState(transaction);
      return { removedMigrations: 35 };
    }),
  };
  return operations;
}

describe("greenfield TEST atomic migration plan", () => {
  it("pins and strips exactly one transaction envelope from all migrations", () => {
    const plan = planGreenfieldAtomicRebuild();
    const migrations = plan.getMigrations();

    expect(plan.migrationCount).toBe(68);
    expect(migrations).toHaveLength(68);
    expect(Object.keys(plan)).toEqual(["migrationCount", "files"]);
    expect(Object.keys(migrations[0])).toEqual(["file", "name", "version"]);
    for (const [index, migration] of migrations.entries()) {
      expect(migration.version).toBe(GREENFIELD_TARGET_VERSIONS[index]);
      expect(
        createHash("sha256").update(migration.getSource()).digest("hex"),
      ).toBe(REVIEWED_MIGRATION_DIGESTS[migration.file]);
      expect(migration.getSource()).toMatch(
        /(?:^|\n)begin;\n[\s\S]*\ncommit;\n$/u,
      );
      expect(migration.getBody()).not.toMatch(
        /^\s*(?:begin|commit|rollback)\s*;\s*$/imu,
      );
      expect(migration.getBody()).not.toMatch(/\bconcurrently\b/iu);
    }
  });

  it("runs teardown, every body/history row, and final reconciliation in one callback", async () => {
    const plan = planGreenfieldAtomicRebuild();
    const sql = database(plan);
    const injected = operations();

    await expect(
      rebuildGreenfieldTestAtomically(sql, plan, injected),
    ).resolves.toEqual({ removedMigrations: 35, ...fingerprint });

    expect(sql.begin).toHaveBeenCalledOnce();
    expect(injected.rebuild).toHaveBeenCalledOnce();
    expect(injected.assertClean).toHaveBeenCalledTimes(2);
    expect(sql.state.committed).toBe(true);
    expect(sql.unsafe).toHaveBeenCalledTimes(138);
    const migrations = plan.getMigrations();
    expect(sql.unsafe.mock.calls[0]).toEqual([migrations[0].getBody()]);
    expect(sql.unsafe.mock.calls[1]).toEqual([
      GREENFIELD_HISTORY_INSERT_SQL,
      [migrations[0].version, migrations[0].getSource(), migrations[0].name],
    ]);
  });

  it.each([
    ["before-pre-teardown-check", -1],
    ["after-pre-teardown-check", -1],
    ["after-teardown", -1],
    ["after-migration", 0],
    ["after-migration", 58],
    ["after-history", 59],
    ["after-migration", 67],
    ["after-history", 67],
    ["before-final-check", 68],
    ["after-final-check", 68],
  ])("does not commit fault injection at %s/%i", async (stage, index) => {
    const failure = new Error(`synthetic ${stage}`);
    const fault = vi.fn(async (actualStage, actualIndex) => {
      if (actualStage === stage && actualIndex === index) throw failure;
    });
    const plan = planGreenfieldAtomicRebuild();
    const sql = database(plan);

    await expect(
      rebuildGreenfieldTestAtomically(sql, plan, operations(fault)),
    ).rejects.toBe(failure);
    expect(sql.state.committed).toBe(false);
  });

  it("rejects persisted history that differs from the reviewed plan", async () => {
    const plan = planGreenfieldAtomicRebuild();
    const history = exactHistory(plan);
    history[18] = { ...history[18], statement: "select 'unreviewed';" };
    const sql = database(plan, { history });

    await expect(
      rebuildGreenfieldTestAtomically(sql, plan, operations()),
    ).rejects.toThrow("migration history is invalid");
    expect(sql.state.committed).toBe(false);
  });

  it.each(["rebuild", "assertClean"])(
    "rolls back when %s rejects",
    async (operation) => {
      const plan = planGreenfieldAtomicRebuild();
      const sql = database(plan);
      const injected = operations();
      const failure = new Error(`synthetic ${operation} failure`);
      injected[operation].mockRejectedValueOnce(failure);

      await expect(
        rebuildGreenfieldTestAtomically(sql, plan, injected),
      ).rejects.toBe(failure);
      expect(sql.state.committed).toBe(false);
    },
  );
});

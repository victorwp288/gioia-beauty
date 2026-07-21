import { describe, expect, it, vi } from "vitest";

import {
  GREENFIELD_REBUILD_DELETE_HISTORY_SQL,
  GREENFIELD_REBUILD_GUARD_SQL,
  GREENFIELD_REBUILD_MUTATION_SQL,
  GREENFIELD_REBUILD_RUNTIME_PRESERVATION_SQL,
  GREENFIELD_REBUILD_SNAPSHOT_SQL,
  GREENFIELD_REBUILD_TRANSACTION_SQL,
  GREENFIELD_REBUILD_VERIFY_SQL,
  rebuildGreenfieldTestDatabaseInTransaction,
} from "../../scripts/test-target-rebuild-sql.mjs";
import { GREENFIELD_TARGET_VERSIONS } from "../../scripts/test-target-migrations.mjs";

function verifiedRow(overrides = {}) {
  return {
    history_empty: true,
    roles_removed: true,
    schema_removed: true,
    roles_exact: true,
    schemas_exact: true,
    schemas_preserved: true,
    roles_preserved: true,
    runtime_credential_preserved: true,
    extensions_preserved: true,
    default_acls_preserved: true,
    schema_acls_preserved: true,
    public_empty: true,
    ...overrides,
  };
}

function database({
  migrationCount = GREENFIELD_TARGET_VERSIONS.length,
  removed = migrationCount,
  verify = verifiedRow(),
} = {}) {
  const unsafe = vi.fn(async (query) => {
    if (query.includes("select count(*)::integer as migration_count")) {
      return [{ migration_count: migrationCount }];
    }
    if (query === GREENFIELD_REBUILD_DELETE_HISTORY_SQL) {
      return [{ removed_migrations: removed }];
    }
    if (query === GREENFIELD_REBUILD_VERIFY_SQL) return [verify];
    return [];
  });
  return { unsafe };
}

describe("greenfield TEST guarded rebuild SQL", () => {
  it("pins both reviewed histories and refuses an unheld advisory lock", () => {
    expect(GREENFIELD_REBUILD_GUARD_SQL).toContain("20260709235933");
    expect(GREENFIELD_REBUILD_GUARD_SQL).toContain("20260710013427");
    expect(GREENFIELD_REBUILD_GUARD_SQL).toContain(
      "pg_try_advisory_xact_lock(7102026, 72135538)",
    );
    expect(GREENFIELD_REBUILD_GUARD_SQL).toContain(
      "migration history is not an exact rebuild state",
    );
    expect(GREENFIELD_REBUILD_GUARD_SQL).not.toContain("app_runtime_login");
  });

  it("guards exact roles, memberships, residue, checksums, and dependencies", () => {
    for (const contract of [
      "custom role attributes are not exact",
      "custom role memberships are not exact",
      "custom role credentials are not exact",
      "runtime ownership is not empty",
      "custom default privileges are not exact",
      "migration history metadata is not exact",
      "private tables are not exact",
      "private functions are not exact",
      "application sessions are active",
      "operational residue exists",
      "Auth residue exists",
      "Storage residue exists",
      "reference checksum is not exact",
      "extended reference rows are not exact",
      "external dependencies on private objects",
    ]) {
      expect(GREENFIELD_REBUILD_GUARD_SQL).toContain(contract);
    }
    expect(GREENFIELD_REBUILD_GUARD_SQL).not.toMatch(/drop owned/iu);
    expect(GREENFIELD_REBUILD_GUARD_SQL).not.toMatch(/truncate/iu);
    expect(GREENFIELD_REBUILD_GUARD_SQL).not.toContain("pg_catalog.coalesce");
    expect(GREENFIELD_REBUILD_GUARD_SQL).toContain(
      "private_drop_closure(classid,objid)",
    );
    expect(GREENFIELD_REBUILD_GUARD_SQL).toContain("d.deptype='i'");
  });

  it("restores only custom defaults and drops only the private schema and roles", () => {
    expect(GREENFIELD_REBUILD_MUTATION_SQL).toEqual([
      "grant gioia_mutator, gioia_migrator to postgres with inherit true, set false granted by current_user",
      "do $$ begin if not pg_catalog.pg_has_role(current_user,'gioia_mutator','USAGE') or not pg_catalog.pg_has_role(current_user,'gioia_migrator','USAGE') then raise exception 'Greenfield TEST temporary default-ACL membership failed'; end if; end $$",
      "alter default privileges for role gioia_mutator grant execute on functions to public",
      "alter default privileges for role gioia_migrator grant execute on functions to public",
      "revoke gioia_mutator, gioia_migrator from postgres granted by current_user",
      "do $$ begin if pg_catalog.pg_has_role(current_user,'gioia_mutator','USAGE') or pg_catalog.pg_has_role(current_user,'gioia_migrator','USAGE') then raise exception 'Greenfield TEST temporary default-ACL membership remained'; end if; end $$",
      "revoke usage on schema extensions from gioia_mutator, gioia_migrator",
      "drop schema gioia_private cascade",
      "drop role gioia_migrator, gioia_mutator",
    ]);
    expect(GREENFIELD_REBUILD_DELETE_HISTORY_SQL).toContain(
      "delete from supabase_migrations.schema_migrations",
    );
    expect(GREENFIELD_REBUILD_DELETE_HISTORY_SQL).not.toMatch(
      /delete from auth/iu,
    );
    expect(GREENFIELD_REBUILD_SNAPSHOT_SQL).toContain(
      "pg_catalog.pg_extension",
    );
    expect(GREENFIELD_REBUILD_SNAPSHOT_SQL).toContain("default_acls");
    expect(GREENFIELD_REBUILD_SNAPSHOT_SQL).toContain("schema_acls");
    expect(GREENFIELD_REBUILD_SNAPSHOT_SQL).toContain(
      "runtime_password_digest",
    );
    expect(GREENFIELD_REBUILD_SNAPSHOT_SQL).not.toContain(
      "as runtime_password,",
    );
    expect(GREENFIELD_REBUILD_VERIFY_SQL).toContain("extensions_preserved");
    expect(GREENFIELD_REBUILD_RUNTIME_PRESERVATION_SQL).toContain(
      "runtime_role_preserved",
    );
  });

  it("runs the exact reviewed target teardown in one transaction", async () => {
    const migrationCount = GREENFIELD_TARGET_VERSIONS.length;
    const sql = database({ migrationCount });
    const assertManagedState = vi.fn(async () => {});

    await expect(
      rebuildGreenfieldTestDatabaseInTransaction(sql, assertManagedState),
    ).resolves.toEqual({
      removedMigrations: migrationCount,
    });

    const calls = sql.unsafe.mock.calls.map(([query]) => query);
    expect(calls.slice(0, 4)).toEqual(GREENFIELD_REBUILD_TRANSACTION_SQL);
    expect(calls.indexOf(GREENFIELD_REBUILD_GUARD_SQL)).toBeLessThan(
      calls.indexOf(GREENFIELD_REBUILD_SNAPSHOT_SQL),
    );
    expect(calls.indexOf(GREENFIELD_REBUILD_SNAPSHOT_SQL)).toBeLessThan(
      calls.indexOf(GREENFIELD_REBUILD_MUTATION_SQL[0]),
    );
    expect(assertManagedState).toHaveBeenCalledExactlyOnceWith(sql);
    expect(assertManagedState.mock.invocationCallOrder[0]).toBeLessThan(
      sql.unsafe.mock.invocationCallOrder[
        calls.indexOf(GREENFIELD_REBUILD_MUTATION_SQL[0])
      ],
    );
    expect(calls.at(-1)).toBe(GREENFIELD_REBUILD_VERIFY_SQL);
  });

  it.each([35, 37, GREENFIELD_TARGET_VERSIONS.length - 1])(
    "fails closed before mutation at unsupported migration count %i",
    async (migrationCount) => {
      const sql = database({ migrationCount });

      await expect(
        rebuildGreenfieldTestDatabaseInTransaction(sql, async () => {}),
      ).rejects.toThrow("pre-state is invalid");
      expect(sql.unsafe).not.toHaveBeenCalledWith(
        GREENFIELD_REBUILD_SNAPSHOT_SQL,
      );
      expect(sql.unsafe).not.toHaveBeenCalledWith(
        GREENFIELD_REBUILD_MUTATION_SQL[0],
      );
    },
  );

  it("rolls back on removal or preservation mismatch", async () => {
    const targetCount = GREENFIELD_TARGET_VERSIONS.length;
    const countMismatch = database({
      migrationCount: targetCount,
      removed: targetCount - 1,
    });
    await expect(
      rebuildGreenfieldTestDatabaseInTransaction(countMismatch, async () => {}),
    ).rejects.toThrow("migration removal did not reconcile");
    expect(countMismatch.unsafe).not.toHaveBeenCalledWith(
      GREENFIELD_REBUILD_VERIFY_SQL,
    );

    const preservationMismatch = database({
      migrationCount: targetCount,
      verify: verifiedRow({ extensions_preserved: false }),
    });
    await expect(
      rebuildGreenfieldTestDatabaseInTransaction(
        preservationMismatch,
        async () => {},
      ),
    ).rejects.toThrow("rebuild verification failed");
  });
});

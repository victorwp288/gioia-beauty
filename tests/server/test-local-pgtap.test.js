import { describe, expect, it, vi } from "vitest";

import {
  LOCAL_PGTAP_CREATOR_MEMBERSHIP_SQL,
  LOCAL_PGTAP_CREATOR_ROLES,
  withLocalPgTapCreatorMemberships,
} from "../../scripts/test-local-pgtap.mjs";

function membership(grantedRole, overrides = {}) {
  return {
    granted_role: grantedRole,
    grantor: "supabase_admin",
    admin_option: true,
    inherit_option: false,
    set_option: false,
    ...overrides,
  };
}

function database(initialRoles, { ignoreRevoke = new Set() } = {}) {
  const memberships = new Map(
    initialRoles.map((role) => [role, membership(role)]),
  );
  const unsafe = vi.fn(async (query) => {
    if (query === LOCAL_PGTAP_CREATOR_MEMBERSHIP_SQL) {
      return [...memberships.values()].sort((left, right) =>
        left.granted_role.localeCompare(right.granted_role),
      );
    }
    const grant = query.match(/^grant ([a-z_]+) to postgres/u);
    if (grant) {
      memberships.set(grant[1], membership(grant[1]));
      return [];
    }
    const revoke = query.match(/^revoke ([a-z_]+) from postgres/u);
    if (revoke) {
      if (!ignoreRevoke.has(revoke[1])) memberships.delete(revoke[1]);
      return [];
    }
    throw new Error("Unexpected synthetic SQL");
  });
  return { unsafe };
}

describe("local pgTAP creator membership lifecycle", () => {
  it("preserves the exact existing direct-role creator memberships", async () => {
    const sql = database(["app_runtime", "gioia_mutator", "gioia_migrator"]);
    const callback = vi.fn(async () => "passed");

    await expect(withLocalPgTapCreatorMemberships(sql, callback)).resolves.toBe(
      "passed",
    );

    const statements = sql.unsafe.mock.calls.map(([query]) => query);
    expect(statements).toEqual([
      LOCAL_PGTAP_CREATOR_MEMBERSHIP_SQL,
      LOCAL_PGTAP_CREATOR_MEMBERSHIP_SQL,
    ]);
    expect(statements).not.toContain(
      "revoke app_runtime from postgres granted by current_user",
    );
    expect(callback).toHaveBeenCalledOnce();
  });

  it("grants missing roles in canonical order and revokes them in reverse", async () => {
    const sql = database([]);

    await withLocalPgTapCreatorMemberships(sql, async () => undefined);

    const mutations = sql.unsafe.mock.calls
      .map(([query]) => query)
      .filter((query) => query !== LOCAL_PGTAP_CREATOR_MEMBERSHIP_SQL);
    expect(mutations).toEqual([
      ...LOCAL_PGTAP_CREATOR_ROLES.map(
        (role) =>
          `grant ${role} to postgres with admin true, inherit false, set false granted by current_user`,
      ),
      ...[...LOCAL_PGTAP_CREATOR_ROLES]
        .reverse()
        .map((role) => `revoke ${role} from postgres granted by current_user`),
    ]);
  });

  it("rejects unexpected pre-existing membership without mutation", async () => {
    const sql = {
      unsafe: vi.fn(async () => [
        membership("app_runtime", { set_option: true }),
      ]),
    };

    await expect(
      withLocalPgTapCreatorMemberships(sql, async () => undefined),
    ).rejects.toThrow("unexpected Gioia role membership");
    expect(sql.unsafe).toHaveBeenCalledOnce();
  });

  it("restores temporary memberships when the pgTAP callback fails", async () => {
    const failure = new Error("synthetic pgTAP failure");
    const sql = database(["app_runtime", "gioia_mutator", "gioia_migrator"]);

    await expect(
      withLocalPgTapCreatorMemberships(sql, async () => {
        throw failure;
      }),
    ).rejects.toBe(failure);
    expect(sql.unsafe).toHaveBeenLastCalledWith(
      LOCAL_PGTAP_CREATOR_MEMBERSHIP_SQL,
    );
  });

  it("fails when final memberships differ from the preflight snapshot", async () => {
    const sql = database([], {
      ignoreRevoke: new Set(["gioia_migrator"]),
    });

    await expect(
      withLocalPgTapCreatorMemberships(sql, async () => undefined),
    ).rejects.toThrow("did not restore creator memberships exactly");
  });
});

import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { createOwnerAuthRepository } from "@/lib/server/database/ownerAuthRepository.ts";
import type {
  RuntimeDatabase,
  RuntimeTransaction,
} from "@/lib/server/database/runtime.ts";

const identity = {
  userId: "10000000-0000-4000-8000-000000000001",
  sessionId: "20000000-0000-4000-8000-000000000001",
};

function setup(rows: Array<Record<string, unknown>>) {
  const unsafe = vi.fn<RuntimeTransaction["unsafe"]>(async () => rows);
  const ownerTransaction = vi.fn(
    async (
      context: typeof identity,
      work: (transaction: RuntimeTransaction) => unknown,
    ) => {
      expect(context).toEqual(identity);
      return work({ unsafe } as RuntimeTransaction);
    },
  );
  return {
    repository: createOwnerAuthRepository({
      ownerTransaction: ownerTransaction as RuntimeDatabase["ownerTransaction"],
    }),
    ownerTransaction,
    unsafe,
  };
}

describe("owner session repository", () => {
  it.each([
    ["startSession", "start_owner_session"],
    ["authorizeSession", "authorize_owner_session"],
    ["revokeSession", "revoke_owner_session"],
  ] as const)("executes bounded %s", async (method, functionName) => {
    const fixture = setup([{ authorized: true }]);
    const result = await fixture.repository[method](identity);
    expect(result).toEqual(method === "revokeSession" ? true : { ok: true });
    expect(fixture.ownerTransaction).toHaveBeenCalledTimes(1);
    expect(fixture.unsafe).toHaveBeenCalledTimes(1);
    expect(fixture.unsafe.mock.calls[0]?.[0]).toContain(
      `gioia_private.${functionName}`,
    );
    expect(fixture.unsafe.mock.calls[0]?.[0]).toContain("limit 1");
    expect(fixture.unsafe.mock.calls[0]?.[1]).toEqual([
      identity.userId,
      identity.sessionId,
    ]);
  });

  it.each([
    [
      "startSession",
      "PT401",
      "OWNER_SESSION_REVOKED",
      { ok: false, status: 401, code: "OWNER_SESSION_REQUIRED" },
    ],
    [
      "authorizeSession",
      "PT403",
      "OWNER_AUTHORIZATION_REQUIRED",
      { ok: false, status: 403, code: "OWNER_AUTHORIZATION_REQUIRED" },
    ],
  ] as const)(
    "maps exact %s denial to its safe API class",
    async (method, databaseCode, message, expected) => {
      const fixture = setup([]);
      fixture.ownerTransaction.mockRejectedValueOnce({
        code: databaseCode,
        message,
      });
      await expect(fixture.repository[method](identity)).resolves.toEqual(
        expected,
      );
    },
  );

  it("propagates revoke denial and infrastructure failures", async () => {
    const fixture = setup([]);
    for (const failure of [
      { code: "PT403", message: "OWNER_SESSION_MISMATCH" },
      new Error("synthetic database unavailable"),
    ]) {
      fixture.ownerTransaction.mockRejectedValueOnce(failure);
      await expect(fixture.repository.revokeSession(identity)).rejects.toBe(
        failure,
      );
    }
  });

  it("surfaces malformed rows as an infrastructure failure", async () => {
    for (const rows of [
      [],
      [{ authorized: false }],
      [{ authorized: true, extra: 1 }],
    ]) {
      const fixture = setup(rows);
      await expect(fixture.repository.startSession(identity)).rejects.toThrow(
        "Unexpected owner session result",
      );
    }
  });
});

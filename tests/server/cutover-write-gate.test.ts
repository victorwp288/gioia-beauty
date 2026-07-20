import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import {
  CUTOVER_CANARY_HEADER,
  createCutoverWriteGate,
} from "@/lib/server/cutoverWriteGate.ts";
import type {
  RuntimeDatabase,
  RuntimeTransaction,
} from "@/lib/server/database/runtime.ts";

function database(mode: "open" | "frozen" | "owner_reconcile") {
  const unsafe = vi.fn(async () => [{ mode, version: 2 }]);
  const transaction = vi.fn(
    async (work: (transaction: RuntimeTransaction) => unknown) =>
      work({ unsafe } as RuntimeTransaction),
  );
  return {
    database: { transaction } as Pick<RuntimeDatabase, "transaction">,
    transaction,
    unsafe,
  };
}

function request(token?: string) {
  return {
    headers: new Headers(token ? { [CUTOVER_CANARY_HEADER]: token } : {}),
  };
}

describe("cutover write gate", () => {
  it("allows ordinary writes only in the appropriate open modes", async () => {
    const open = database("open");
    await expect(
      createCutoverWriteGate(open.database).check(request(), "public"),
    ).resolves.toEqual({ ok: true, canaryToken: null, mode: "open" });

    const reconcile = database("owner_reconcile");
    await expect(
      createCutoverWriteGate(reconcile.database).check(request(), "owner"),
    ).resolves.toEqual({
      ok: true,
      canaryToken: null,
      mode: "owner_reconcile",
    });
    const publicResult = await createCutoverWriteGate(reconcile.database).check(
      request(),
      "public",
    );
    expect(publicResult.ok).toBe(false);
  });

  it("returns a fixed private maintenance response before mutation work", async () => {
    for (const token of [undefined, "short", "A".repeat(44)]) {
      const fixture = database("frozen");
      const result = await createCutoverWriteGate(fixture.database).check(
        request(token),
        "owner",
      );
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.response.status).toBe(503);
        expect(await result.response.json()).toMatchObject({
          code: "MAINTENANCE_ACTIVE",
        });
        expect(result.response.headers.get("retry-after")).toBe("300");
        expect(result.response.headers.get("cache-control")).toContain(
          "no-store",
        );
      }
    }
  });

  it("passes only a canonical in-memory canary token during a freeze", async () => {
    const token = "A".repeat(43);
    const fixture = database("frozen");
    await expect(
      createCutoverWriteGate(fixture.database).check(request(token), "public"),
    ).resolves.toEqual({ ok: true, canaryToken: token, mode: "frozen" });

    const open = database("open");
    const result = await createCutoverWriteGate(open.database).check(
      request(token),
      "public",
    );
    expect(result.ok).toBe(false);
  });

  it("fails closed without reflecting database details", async () => {
    const transaction = vi.fn(async () => {
      throw new Error("private database detail");
    });
    const result = await createCutoverWriteGate({ transaction }).check(
      request(),
      "public",
    );
    expect(result.ok).toBe(false);
    if (!result.ok) {
      const body = await result.response.text();
      expect(JSON.parse(body)).toMatchObject({
        code: "SERVICE_UNAVAILABLE",
      });
      expect(body).not.toContain("private");
    }
  });
});

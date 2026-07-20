import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { createMaintenanceStatusGetHandler } from "@/lib/server/maintenanceStatusHandler.ts";
import type {
  RuntimeDatabase,
  RuntimeTransaction,
} from "@/lib/server/database/runtime.ts";

function handler(mode: "open" | "frozen" | "owner_reconcile") {
  const unsafe = vi.fn(async () => [{ mode, version: 3 }]);
  const transaction = vi.fn(
    async (work: (transaction: RuntimeTransaction) => unknown) =>
      work({ unsafe } as RuntimeTransaction),
  );
  return createMaintenanceStatusGetHandler({
    transaction,
  } as Pick<RuntimeDatabase, "transaction">);
}

describe("GET /api/maintenance", () => {
  it.each([
    ["open", true, true, "OPERATIONS_OPEN"],
    ["frozen", false, false, "MAINTENANCE_ACTIVE"],
    ["owner_reconcile", false, true, "OWNER_RECONCILIATION_ACTIVE"],
  ] as const)(
    "returns redacted %s state",
    async (mode, publicEnabled, ownerEnabled, code) => {
      const response = await handler(mode)(
        new Request("https://www.gioiabeauty.net/api/maintenance"),
      );
      expect(response.status).toBe(200);
      expect(await response.json()).toEqual({
        code: "MAINTENANCE_STATUS",
        publicBookingEnabled: publicEnabled,
        ownerMutationsEnabled: ownerEnabled,
        messageCode: code,
      });
      expect(response.headers.get("cache-control")).toContain("no-store");
    },
  );

  it("rejects query input without database work", async () => {
    const transaction = vi.fn();
    const response = await createMaintenanceStatusGetHandler({ transaction })(
      new Request("https://www.gioiabeauty.net/api/maintenance?detail=1"),
    );
    expect(response.status).toBe(400);
    expect(transaction).not.toHaveBeenCalled();
  });
});

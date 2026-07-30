import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { createMaintenanceStatusGetHandler } from "@/lib/server/maintenanceStatusHandler.ts";
import {
  DatabaseConfigurationError,
  DatabaseRuntimeError,
} from "@/lib/server/database/runtime.ts";
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

  it.each([
    [new DatabaseConfigurationError(), "configuration"],
    [
      new DatabaseRuntimeError("connection", "authentication"),
      "database_connection_authentication",
    ],
    [new DatabaseRuntimeError("query", "unknown"), "database_query_unknown"],
    [new Error("secret database detail"), "database_unknown"],
  ] as const)(
    "logs only the fixed dependency stage for a failed maintenance read",
    async (failure, expectedStage) => {
      const failureSink = vi.fn();
      const response = await createMaintenanceStatusGetHandler(
        {
          transaction: vi.fn(async () => {
            throw failure;
          }),
        },
        failureSink,
      )(new Request("https://www.gioiabeauty.net/api/maintenance"));

      expect(response.status).toBe(503);
      expect(await response.json()).toMatchObject({
        code: "SERVICE_UNAVAILABLE",
      });
      expect(failureSink).toHaveBeenCalledOnce();
      expect(failureSink).toHaveBeenCalledWith(expectedStage);
      expect(JSON.stringify(failureSink.mock.calls)).not.toContain("secret");
    },
  );
});

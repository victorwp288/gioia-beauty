import { afterEach, describe, expect, it, vi } from "vitest";

import { getMaintenanceStatus } from "@/lib/client/maintenanceApi.ts";

afterEach(() => vi.unstubAllGlobals());

function jsonResponse(body: unknown, init: ResponseInit = {}) {
  return new Response(JSON.stringify(body), {
    ...init,
    headers: { "Content-Type": "application/json" },
  });
}

describe("maintenance API client", () => {
  it("requests the strict uncached same-origin status contract", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      jsonResponse({
        code: "MAINTENANCE_STATUS",
        messageCode: "MAINTENANCE_ACTIVE",
        ownerMutationsEnabled: false,
        publicBookingEnabled: false,
      }),
    );
    vi.stubGlobal("fetch", fetchMock);
    const controller = new AbortController();

    await expect(
      getMaintenanceStatus(controller.signal),
    ).resolves.toMatchObject({
      messageCode: "MAINTENANCE_ACTIVE",
      ownerMutationsEnabled: false,
      publicBookingEnabled: false,
    });
    expect(fetchMock).toHaveBeenCalledWith("/api/maintenance", {
      cache: "no-store",
      credentials: "same-origin",
      headers: { Accept: "application/json" },
      method: "GET",
      signal: controller.signal,
    });
  });

  it("fails closed for unavailable and malformed status responses", async () => {
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockResolvedValueOnce(
          jsonResponse({ code: "SERVICE_UNAVAILABLE" }, { status: 503 }),
        )
        .mockResolvedValueOnce(
          jsonResponse({
            code: "MAINTENANCE_STATUS",
            messageCode: "OPERATIONS_OPEN",
            ownerMutationsEnabled: true,
            publicBookingEnabled: true,
            unexpected: true,
          }),
        ),
    );

    await expect(getMaintenanceStatus()).rejects.toThrow(
      "MAINTENANCE_STATUS_UNAVAILABLE",
    );
    await expect(getMaintenanceStatus()).rejects.toThrow(
      "INVALID_MAINTENANCE_STATUS",
    );
  });
});

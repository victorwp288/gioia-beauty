import { beforeEach, describe, expect, it, vi } from "vitest";

const CSRF = "a".repeat(43);
const REQUEST_ID = "10000000-0000-4000-8000-000000000001";
const RESOURCE_ID = "20000000-0000-4000-8000-000000000001";

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function sessionResponse() {
  return json({ code: "OWNER_SESSION_ACTIVE", csrfToken: CSRF });
}

function successResponse() {
  return json({
    code: "APPOINTMENT_CREATED",
    resourceId: RESOURCE_ID,
    replayed: false,
  });
}

function errorResponse(code: string, status: number) {
  return json({ code, requestId: REQUEST_ID }, status);
}

beforeEach(() => {
  vi.restoreAllMocks();
  vi.resetModules();
});

describe("owner API client", () => {
  it("uses one bounded no-store schedule request", async () => {
    const fetchMock = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(json({ items: [], nextCursor: null }));
    const { getOwnerSchedule } = await import("@/lib/client/ownerApi.ts");

    await expect(
      getOwnerSchedule({
        fromDate: "2030-01-01",
        toDate: "2030-01-31",
        pageSize: 100,
        statuses: ["confirmed", "active"],
      }),
    ).resolves.toEqual({ items: [], nextCursor: null });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(String(url)).toContain("fromDate=2030-01-01");
    expect(String(url)).toContain("pageSize=100");
    expect(String(url).match(/status=/g)).toHaveLength(2);
    expect(init).toMatchObject({ cache: "no-store", method: "GET" });
  });

  it("retries one ambiguous server response with the same idempotency key", async () => {
    const fetchMock = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(sessionResponse())
      .mockResolvedValueOnce(errorResponse("SERVICE_UNAVAILABLE", 503))
      .mockResolvedValueOnce(successResponse());
    const { runOwnerCommand } = await import("@/lib/client/ownerApi.ts");

    await runOwnerCommand("/api/admin/appointments", { value: 1 });

    const firstHeaders = new Headers(fetchMock.mock.calls[1]![1]?.headers);
    const retryHeaders = new Headers(fetchMock.mock.calls[2]![1]?.headers);
    expect(firstHeaders.get("Idempotency-Key")).toMatch(/^[0-9a-f-]{36}$/);
    expect(retryHeaders.get("Idempotency-Key")).toBe(
      firstHeaders.get("Idempotency-Key"),
    );
  });

  it("retains an ambiguous key across a later identical owner intent", async () => {
    const fetchMock = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(sessionResponse())
      .mockRejectedValueOnce(new TypeError("network"))
      .mockRejectedValueOnce(new TypeError("network"))
      .mockResolvedValueOnce(successResponse());
    const { runOwnerCommand } = await import("@/lib/client/ownerApi.ts");
    const body = { value: 2 };

    await expect(
      runOwnerCommand("/api/admin/appointments", body),
    ).rejects.toMatchObject({ code: "NETWORK_ERROR" });
    await runOwnerCommand("/api/admin/appointments", body);

    const firstKey = new Headers(fetchMock.mock.calls[1]![1]?.headers).get(
      "Idempotency-Key",
    );
    const laterKey = new Headers(fetchMock.mock.calls[3]![1]?.headers).get(
      "Idempotency-Key",
    );
    expect(laterKey).toBe(firstKey);
  });

  it("rotates the key after a deterministic conflict", async () => {
    const fetchMock = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(sessionResponse())
      .mockResolvedValueOnce(errorResponse("VERSION_CONFLICT", 409))
      .mockResolvedValueOnce(successResponse());
    const { runOwnerCommand } = await import("@/lib/client/ownerApi.ts");
    const body = { value: 3 };

    await expect(
      runOwnerCommand("/api/admin/appointments", body),
    ).rejects.toMatchObject({ code: "VERSION_CONFLICT" });
    await runOwnerCommand("/api/admin/appointments", body);

    const firstKey = new Headers(fetchMock.mock.calls[1]![1]?.headers).get(
      "Idempotency-Key",
    );
    const laterKey = new Headers(fetchMock.mock.calls[2]![1]?.headers).get(
      "Idempotency-Key",
    );
    expect(laterKey).not.toBe(firstKey);
  });
});

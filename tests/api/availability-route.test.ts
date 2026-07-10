import { describe, expect, it, vi, type Mock } from "vitest";

vi.mock("server-only", () => ({}));

import { createAvailabilityGetHandler } from "@/lib/server/availabilityHandler.ts";
import type { PublicAbuseGuard } from "@/lib/server/publicAbuseBoundary.ts";

const REQUEST_ID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const VALID_QUERY =
  "date=2026-08-10&serviceId=manicure&variantId=manicure-30-min";

function request(query = VALID_QUERY) {
  return new Request(`https://www.gioiabeauty.net/api/availability?${query}`);
}

type AvailabilityFunction = (input: {
  date: string;
  serviceId: string;
  variantId: string;
}) => Promise<Array<Record<string, unknown>>>;

function createAllowingAbuseGuard(): PublicAbuseGuard {
  return {
    check: vi.fn(async () => ({
      ok: true as const,
      principalScopeHash: Buffer.alloc(32, 7),
    })),
  };
}

function createHandler(
  getAvailability: Mock<AvailabilityFunction> = vi.fn<AvailabilityFunction>(
    async () => [{ start_minutes: 600 }, { start_minutes: 615 }],
  ),
  abuseGuard: PublicAbuseGuard = createAllowingAbuseGuard(),
) {
  return {
    abuseGuard,
    getAvailability,
    handler: createAvailabilityGetHandler({
      abuseGuard,
      database: { getAvailability },
      createRequestId: () => REQUEST_ID,
    }),
  };
}

describe("GET /api/availability", () => {
  it("returns only a validated, bounded, non-cacheable slot response", async () => {
    const { abuseGuard, handler, getAvailability } = createHandler();
    const availabilityRequest = request();
    const response = await handler(availabilityRequest);

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      date: "2026-08-10",
      serviceId: "manicure",
      variantId: "manicure-30-min",
      slots: [600, 615],
    });
    expect(getAvailability).toHaveBeenCalledTimes(1);
    expect(getAvailability).toHaveBeenCalledWith({
      date: "2026-08-10",
      serviceId: "manicure",
      variantId: "manicure-30-min",
    });
    expect(abuseGuard.check).toHaveBeenCalledTimes(1);
    expect(abuseGuard.check).toHaveBeenCalledWith(
      {
        headers: expect.any(Headers),
      },
      "public_availability",
    );
    expect(vi.mocked(abuseGuard.check).mock.calls[0]?.[0]).not.toHaveProperty(
      "body",
    );
    expect(response.headers.get("cache-control")).toContain("no-store");
    expect(response.headers.get("x-content-type-options")).toBe("nosniff");
    expect(response.headers.get("referrer-policy")).toBe("no-referrer");
  });

  it.each([
    "date=2026-08-10&serviceId=manicure",
    `${VALID_QUERY}&unknown=value`,
    `${VALID_QUERY}&date=2026-08-11`,
    "date=not-a-date&serviceId=manicure&variantId=manicure-30-min",
  ])(
    "rejects malformed or ambiguous query %s before the database",
    async (query) => {
      const { abuseGuard, handler, getAvailability } = createHandler();
      const response = await handler(request(query));

      expect(response.status).toBe(422);
      expect(await response.json()).toEqual({
        code: "INVALID_QUERY",
        requestId: REQUEST_ID,
      });
      expect(abuseGuard.check).not.toHaveBeenCalled();
      expect(getAvailability).not.toHaveBeenCalled();
    },
  );

  it("rejects oversized queries before the database", async () => {
    const { abuseGuard, handler, getAvailability } = createHandler();
    const response = await handler(request(`padding=${"x".repeat(1_100)}`));

    expect(response.status).toBe(414);
    expect(abuseGuard.check).not.toHaveBeenCalled();
    expect(getAvailability).not.toHaveBeenCalled();
  });

  it("evaluates abuse protection after query validation and before the database", async () => {
    const events: string[] = [];
    const abuseGuard: PublicAbuseGuard = {
      check: vi.fn(async () => {
        events.push("guard");
        return {
          ok: true as const,
          principalScopeHash: Buffer.alloc(32, 7),
        };
      }),
    };
    const getAvailability = vi.fn<AvailabilityFunction>(async () => {
      events.push("database");
      return [{ start_minutes: 600 }];
    });
    const { handler } = createHandler(getAvailability, abuseGuard);

    const response = await handler(request());

    expect(response.status).toBe(200);
    expect(events).toEqual(["guard", "database"]);
  });

  it.each([
    {
      decision: {
        ok: false as const,
        status: 403 as const,
        code: "HUMAN_VERIFICATION_REQUIRED" as const,
      },
      status: 403,
      code: "HUMAN_VERIFICATION_REQUIRED",
      retryAfter: null,
    },
    {
      decision: {
        ok: false as const,
        status: 429 as const,
        code: "RATE_LIMITED" as const,
        retryAfterSeconds: 60,
      },
      status: 429,
      code: "RATE_LIMITED",
      retryAfter: "60",
    },
    {
      decision: {
        ok: false as const,
        status: 503 as const,
        code: "SERVICE_UNAVAILABLE" as const,
      },
      status: 503,
      code: "SERVICE_UNAVAILABLE",
      retryAfter: null,
    },
  ])(
    "returns fixed $status abuse rejection before database work",
    async ({ decision, status, code, retryAfter }) => {
      const abuseGuard: PublicAbuseGuard = {
        check: vi.fn(async () => decision),
      };
      const { handler, getAvailability } = createHandler(undefined, abuseGuard);

      const response = await handler(request());

      expect(response.status).toBe(status);
      expect(await response.json()).toEqual({ code, requestId: REQUEST_ID });
      expect(response.headers.get("retry-after")).toBe(retryAfter);
      expect(abuseGuard.check).toHaveBeenCalledTimes(1);
      expect(getAvailability).not.toHaveBeenCalled();
    },
  );

  it.each([
    {
      ok: false,
      status: 429,
      code: "RATE_LIMITED",
      retryAfterSeconds: 3_601,
    },
    {
      ok: false,
      status: 403,
      code: "RATE_LIMITED",
      retryAfterSeconds: 60,
    },
    {
      ok: false,
      status: 503,
      code: "SERVICE_UNAVAILABLE",
      detail: "cliente@example.test secret-token",
    },
  ])("fails closed on malformed abuse decisions", async (decision) => {
    const abuseGuard = {
      check: vi.fn(async () => decision),
    } as unknown as PublicAbuseGuard;
    const { handler, getAvailability } = createHandler(undefined, abuseGuard);

    const response = await handler(request());
    const text = await response.text();

    expect(response.status).toBe(503);
    expect(JSON.parse(text)).toEqual({
      code: "SERVICE_UNAVAILABLE",
      requestId: REQUEST_ID,
    });
    expect(text).not.toContain("cliente@example.test");
    expect(text).not.toContain("secret-token");
    expect(getAvailability).not.toHaveBeenCalled();
  });

  it("redacts thrown abuse-guard errors and performs no database work", async () => {
    const abuseGuard: PublicAbuseGuard = {
      check: vi.fn(async () => {
        throw new Error("cliente@example.test secret-token");
      }),
    };
    const { handler, getAvailability } = createHandler(undefined, abuseGuard);

    const response = await handler(request());
    const text = await response.text();

    expect(response.status).toBe(503);
    expect(JSON.parse(text)).toEqual({
      code: "SERVICE_UNAVAILABLE",
      requestId: REQUEST_ID,
    });
    expect(text).not.toContain("cliente@example.test");
    expect(text).not.toContain("secret-token");
    expect(getAvailability).not.toHaveBeenCalled();
  });

  it("maps known database domain errors without reflecting internals", async () => {
    const getAvailability = vi
      .fn()
      .mockRejectedValue(
        Object.assign(new Error("ACTIVE_VARIANT_NOT_FOUND"), { code: "PT404" }),
      );
    const { handler } = createHandler(getAvailability);
    const response = await handler(request());

    expect(response.status).toBe(404);
    expect(await response.json()).toEqual({
      code: "ACTIVE_VARIANT_NOT_FOUND",
      requestId: REQUEST_ID,
    });
  });

  it("redacts unavailable database errors and any PII they contain", async () => {
    const getAvailability = vi
      .fn()
      .mockRejectedValue(new Error("cliente@example.test database secret"));
    const { handler } = createHandler(getAvailability);
    const response = await handler(request());
    const text = await response.text();

    expect(response.status).toBe(503);
    expect(text).toContain("SERVICE_UNAVAILABLE");
    expect(text).not.toContain("cliente@example.test");
    expect(getAvailability).toHaveBeenCalledTimes(1);
  });

  it("fails closed if database output violates the public response schema", async () => {
    const getAvailability = vi
      .fn()
      .mockResolvedValue([{ start_minutes: 610, client_email: "pii@test" }]);
    const { handler } = createHandler(getAvailability);
    const response = await handler(request());
    const text = await response.text();

    expect(response.status).toBe(503);
    expect(text).not.toContain("pii@test");
  });
});

import { describe, expect, it, vi, type Mock } from "vitest";

vi.mock("server-only", () => ({}));

import { createAvailabilityGetHandler } from "@/lib/server/availabilityHandler.ts";

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

function createHandler(
  getAvailability: Mock<AvailabilityFunction> = vi.fn<AvailabilityFunction>(
    async () => [{ start_minutes: 600 }, { start_minutes: 615 }],
  ),
) {
  return {
    getAvailability,
    handler: createAvailabilityGetHandler({
      database: { getAvailability },
      createRequestId: () => REQUEST_ID,
    }),
  };
}

describe("GET /api/availability", () => {
  it("returns only a validated, bounded, non-cacheable slot response", async () => {
    const { handler, getAvailability } = createHandler();
    const response = await handler(request());

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
      const { handler, getAvailability } = createHandler();
      const response = await handler(request(query));

      expect(response.status).toBe(422);
      expect(await response.json()).toEqual({
        code: "INVALID_QUERY",
        requestId: REQUEST_ID,
      });
      expect(getAvailability).not.toHaveBeenCalled();
    },
  );

  it("rejects oversized queries before the database", async () => {
    const { handler, getAvailability } = createHandler();
    const response = await handler(request(`padding=${"x".repeat(1_100)}`));

    expect(response.status).toBe(414);
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
      .mockResolvedValue([{ start_minutes: 601, client_email: "pii@test" }]);
    const { handler } = createHandler(getAvailability);
    const response = await handler(request());
    const text = await response.text();

    expect(response.status).toBe(503);
    expect(text).not.toContain("pii@test");
  });
});

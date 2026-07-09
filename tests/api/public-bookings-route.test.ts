import { describe, expect, it, vi, type Mock } from "vitest";

vi.mock("server-only", () => ({}));

import { createPublicBookingPostHandler } from "@/lib/server/publicBookingHandler.ts";

const REQUEST_ID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const IDEMPOTENCY_KEY = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const RESOURCE_ID = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
const bookingBody = {
  date: "2026-08-10",
  startMinutes: 600,
  serviceId: "manicure",
  variantId: "manicure-30-min",
  clientName: "  Cliente Test  ",
  clientEmail: "CLIENTE@EXAMPLE.TEST",
  clientPhone: "+39 000 000 000",
  clientNote: "  Nota sintetica  ",
};

function bookingRequest(
  body: unknown = bookingBody,
  headers: Record<string, string> = {},
) {
  return new Request("https://www.gioiabeauty.net/api/bookings", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "idempotency-key": IDEMPOTENCY_KEY,
      "x-forwarded-for": "192.0.2.10",
      ...headers,
    },
    body: typeof body === "string" ? body : JSON.stringify(body),
  });
}

type CreateBookingFunction = (
  input: Parameters<
    Parameters<
      typeof createPublicBookingPostHandler
    >[0]["database"]["createBooking"]
  >[0],
) => Promise<Record<string, unknown>>;

function createHandler(
  createBooking: Mock<CreateBookingFunction> = vi.fn<CreateBookingFunction>(
    async () => ({
      http_status: 201,
      result: { code: "BOOKING_CREATED", resource_id: RESOURCE_ID },
      replayed: false,
    }),
  ),
) {
  return {
    createBooking,
    handler: createPublicBookingPostHandler({
      database: { createBooking },
      env: { APP_ENV: "test" },
      createRequestId: () => REQUEST_ID,
    }),
  };
}

describe("POST /api/bookings", () => {
  it.each([false, true])(
    "returns a validated success response when replayed=%s",
    async (replayed) => {
      const createBooking = vi.fn().mockResolvedValue({
        http_status: 201,
        result: { code: "BOOKING_CREATED", resource_id: RESOURCE_ID },
        replayed,
      });
      const { handler } = createHandler(createBooking);
      const response = await handler(bookingRequest());
      const payload = await response.json();

      expect(response.status).toBe(201);
      expect(payload).toEqual({
        code: "BOOKING_CREATED",
        resourceId: RESOURCE_ID,
        replayed,
      });
      expect(JSON.stringify(payload)).not.toContain("CLIENTE@EXAMPLE.TEST");
      expect(response.headers.get("cache-control")).toContain("no-store");
      expect(response.headers.get("x-content-type-options")).toBe("nosniff");
      expect(createBooking).toHaveBeenCalledTimes(1);
    },
  );

  it("normalizes inputs and sends only irreversible hashes plus bounded fields", async () => {
    const { handler, createBooking } = createHandler();
    await handler(bookingRequest());

    const input = createBooking.mock.calls[0]![0];
    expect(input).toMatchObject({
      idempotencyKey: IDEMPOTENCY_KEY,
      clientName: "Cliente Test",
      clientEmail: "cliente@example.test",
      clientPhone: "+39000000000",
      clientNote: "Nota sintetica",
    });
    expect(input.principalScopeHash).toBeInstanceOf(Buffer);
    expect(input.principalScopeHash).toHaveLength(32);
    expect(input.requestFingerprint).toBeInstanceOf(Buffer);
    expect(input.requestFingerprint).toHaveLength(32);
    expect(JSON.stringify(input.principalScopeHash)).not.toContain(
      "192.0.2.10",
    );
  });

  it("rejects missing, malformed, and oversized idempotency headers", async () => {
    for (const header of ["", "not-a-uuid", "x".repeat(129)]) {
      const { handler, createBooking } = createHandler();
      const response = await handler(
        bookingRequest(bookingBody, { "idempotency-key": header }),
      );

      expect(response.status).toBe(400);
      expect(createBooking).not.toHaveBeenCalled();
    }
  });

  it("rejects malformed JSON, wrong media type, and schema violations", async () => {
    const cases: Array<[Request, number]> = [
      [bookingRequest("{not-json"), 400],
      [bookingRequest(bookingBody, { "content-type": "text/plain" }), 415],
      [
        bookingRequest(bookingBody, { "content-type": "application/jsonp" }),
        415,
      ],
      [bookingRequest({ ...bookingBody, startMinutes: "600" }), 422],
      [
        bookingRequest({ ...bookingBody, idempotencyKey: IDEMPOTENCY_KEY }),
        422,
      ],
    ];

    for (const [request, status] of cases) {
      const { handler, createBooking } = createHandler();
      expect((await handler(request)).status).toBe(status);
      expect(createBooking).not.toHaveBeenCalled();
    }
  });

  it("enforces declared and observed body bounds", async () => {
    const declared = bookingRequest(bookingBody, {
      "content-length": String(9_000),
    });
    const observed = bookingRequest(
      JSON.stringify({ ...bookingBody, clientNote: "x".repeat(9_000) }),
    );

    for (const request of [declared, observed]) {
      const { handler, createBooking } = createHandler();
      expect((await handler(request)).status).toBe(413);
      expect(createBooking).not.toHaveBeenCalled();
    }
  });

  it("rejects cross-origin mutations before parsing or database access", async () => {
    const { handler, createBooking } = createHandler();
    const response = await handler(
      bookingRequest(bookingBody, { origin: "https://attacker.test" }),
    );

    expect(response.status).toBe(403);
    expect(createBooking).not.toHaveBeenCalled();
  });

  it("maps stored and thrown slot conflicts to redacted 409 responses", async () => {
    const stored = createHandler(
      vi.fn().mockResolvedValue({
        http_status: 409,
        result: { code: "SLOT_UNAVAILABLE" },
        replayed: false,
      }),
    );
    const thrown = createHandler(
      vi
        .fn()
        .mockRejectedValue(
          Object.assign(new Error("IDEMPOTENCY_KEY_REUSED"), { code: "PT409" }),
        ),
    );

    const storedResponse = await stored.handler(bookingRequest());
    const thrownResponse = await thrown.handler(bookingRequest());
    expect(storedResponse.status).toBe(409);
    expect(await storedResponse.json()).toMatchObject({
      code: "SLOT_UNAVAILABLE",
    });
    expect(thrownResponse.status).toBe(409);
    expect(await thrownResponse.json()).toMatchObject({
      code: "IDEMPOTENCY_KEY_REUSED",
    });
    expect(stored.createBooking).toHaveBeenCalledTimes(1);
    expect(thrown.createBooking).toHaveBeenCalledTimes(1);
  });

  it("maps a stored vacation closure to a redacted 409 response", async () => {
    const createBooking = vi.fn<CreateBookingFunction>().mockResolvedValue({
      http_status: 409,
      result: { code: "DATE_CLOSED_FOR_VACATION" },
      replayed: false,
    });
    const { handler } = createHandler(createBooking);
    const response = await handler(bookingRequest());

    expect(response.status).toBe(409);
    expect(await response.json()).toEqual({
      code: "DATE_CLOSED_FOR_VACATION",
      requestId: REQUEST_ID,
    });
    expect(createBooking).toHaveBeenCalledTimes(1);
  });

  it("redacts database failures and malformed rows without leaking PII", async () => {
    const failures = [
      vi.fn().mockRejectedValue(new Error("cliente@example.test db secret")),
      vi.fn().mockResolvedValue({
        http_status: 201,
        result: {
          code: "BOOKING_CREATED",
          resource_id: RESOURCE_ID,
          client_email: "cliente@example.test",
        },
        replayed: false,
      }),
    ];

    for (const createBooking of failures) {
      const { handler } = createHandler(createBooking);
      const response = await handler(bookingRequest());
      const text = await response.text();
      expect(response.status).toBe(503);
      expect(text).toContain("SERVICE_UNAVAILABLE");
      expect(text).not.toContain("cliente@example.test");
      expect(createBooking).toHaveBeenCalledTimes(1);
    }
  });
});

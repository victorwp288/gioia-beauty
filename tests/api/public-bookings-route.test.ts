import { describe, expect, it, vi, type Mock } from "vitest";

vi.mock("server-only", () => ({}));

import { createPublicBookingPostHandler } from "@/lib/server/publicBookingHandler.ts";
import type { PublicAbuseGuard } from "@/lib/server/publicAbuseBoundary.ts";

const REQUEST_ID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const IDEMPOTENCY_KEY = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const RESOURCE_ID = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
const PRINCIPAL_SCOPE_HASH = Buffer.alloc(32, 0x5a);
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
  body: unknown | Uint8Array | ReadableStream<Uint8Array> = bookingBody,
  headers: Record<string, string> = {},
  url = "https://www.gioiabeauty.net/api/bookings",
) {
  const requestBody =
    typeof body === "string" ||
    body instanceof Uint8Array ||
    body instanceof ReadableStream
      ? body
      : JSON.stringify(body);
  return new Request(url, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "idempotency-key": IDEMPOTENCY_KEY,
      "x-forwarded-for": "192.0.2.10",
      ...headers,
    },
    body: requestBody,
    ...(body instanceof ReadableStream ? { duplex: "half" } : {}),
  } as RequestInit);
}

type CreateBookingFunction = (
  input: Parameters<
    Parameters<
      typeof createPublicBookingPostHandler
    >[0]["database"]["createBooking"]
  >[0],
) => Promise<Record<string, unknown>>;

function createAbuseGuard(
  result: unknown = {
    ok: true,
    principalScopeHash: Buffer.from(PRINCIPAL_SCOPE_HASH),
  },
) {
  const check = vi.fn<PublicAbuseGuard["check"]>(async () => result);
  return { guard: { check } satisfies PublicAbuseGuard, check };
}

function createHandler(
  createBooking: Mock<CreateBookingFunction> = vi.fn<CreateBookingFunction>(
    async () => ({
      http_status: 201,
      result: { code: "BOOKING_CREATED", resource_id: RESOURCE_ID },
      replayed: false,
    }),
  ),
  abuse = createAbuseGuard(),
) {
  return {
    createBooking,
    abuseCheck: abuse.check,
    handler: createPublicBookingPostHandler({
      database: { createBooking },
      abuseGuard: abuse.guard,
      writeGate: {
        check: vi.fn(async () => ({
          ok: true as const,
          canaryToken: null,
          mode: "open" as const,
        })),
      },
      createRequestId: () => REQUEST_ID,
    }),
  };
}

describe("POST /api/bookings", () => {
  it("accepts the canonical browser origin from Host behind an internal URL", async () => {
    const { handler } = createHandler();
    const response = await handler(
      bookingRequest(
        bookingBody,
        { host: "127.0.0.1:3100", origin: "http://127.0.0.1:3100" },
        "http://localhost:3100/api/bookings",
      ),
    );

    expect(response.status).toBe(201);
  });

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

  it("normalizes inputs and copies the guard-approved hash with bounded fields", async () => {
    const approvedHash = Buffer.alloc(32, 0x3c);
    const abuse = createAbuseGuard({
      ok: true,
      principalScopeHash: approvedHash,
    });
    const { handler, createBooking } = createHandler(undefined, abuse);
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
    expect(input.principalScopeHash).toEqual(approvedHash);
    expect(input.principalScopeHash).not.toBe(approvedHash);
    expect(input.requestFingerprint).toBeInstanceOf(Buffer);
    expect(input.requestFingerprint).toHaveLength(32);
    expect(JSON.stringify(input.principalScopeHash)).not.toContain(
      "192.0.2.10",
    );
    expect(abuse.check).toHaveBeenCalledWith(
      { headers: expect.any(Headers) },
      "public_booking",
    );
    expect(abuse.check).toHaveBeenCalledWith(
      { headers: expect.any(Headers) },
      "public_booking",
      {
        kind: "account",
        value: "cliente@example.test",
        humanVerified: false,
      },
    );
    expect(abuse.check.mock.calls[0]?.[0]).not.toHaveProperty("body");
  });

  it("excludes changing guard evidence from the booking fingerprint", async () => {
    const first = createHandler(
      undefined,
      createAbuseGuard({
        ok: true,
        principalScopeHash: Buffer.alloc(32, 0x11),
      }),
    );
    const second = createHandler(
      undefined,
      createAbuseGuard({
        ok: true,
        principalScopeHash: Buffer.alloc(32, 0x22),
      }),
    );

    await first.handler(bookingRequest());
    await second.handler(bookingRequest());

    const firstInput = first.createBooking.mock.calls[0]![0];
    const secondInput = second.createBooking.mock.calls[0]![0];
    expect(firstInput.principalScopeHash).not.toEqual(
      secondInput.principalScopeHash,
    );
    expect(firstInput.requestFingerprint).toEqual(
      secondInput.requestFingerprint,
    );
  });

  it("accepts the canonical UTF-8 media type and identity encoding", async () => {
    const { handler, createBooking } = createHandler();
    const response = await handler(
      bookingRequest(bookingBody, {
        "content-type": "Application/JSON;charset=UTF-8",
        "content-encoding": "Identity",
      }),
    );

    expect(response.status).toBe(201);
    expect(createBooking).toHaveBeenCalledOnce();
  });

  it("runs network then account guards around bounded body parsing", async () => {
    const events: string[] = [];
    const abuse = createAbuseGuard();
    abuse.check.mockImplementation(async () => {
      events.push("guard");
      return {
        ok: true,
        principalScopeHash: Buffer.from(PRINCIPAL_SCOPE_HASH),
      };
    });
    const createBooking = vi
      .fn<CreateBookingFunction>()
      .mockImplementation(async () => {
        events.push("database");
        return {
          http_status: 201,
          result: { code: "BOOKING_CREATED", resource_id: RESOURCE_ID },
          replayed: false,
        };
      });
    const { handler } = createHandler(createBooking, abuse);
    const request = bookingRequest();
    const originalGetReader = request.body!.getReader.bind(request.body);
    vi.spyOn(request.body!, "getReader").mockImplementation(() => {
      events.push("body");
      return originalGetReader();
    });

    expect((await handler(request)).status).toBe(201);
    expect(events).toEqual(["guard", "body", "guard", "database"]);
  });

  it("stops before booking persistence when the normalized account scope is limited", async () => {
    const abuse = createAbuseGuard();
    abuse.check
      .mockResolvedValueOnce({
        ok: true,
        principalScopeHash: Buffer.from(PRINCIPAL_SCOPE_HASH),
      })
      .mockResolvedValueOnce({
        ok: false,
        status: 429,
        code: "RATE_LIMITED",
        retryAfterSeconds: 120,
      });
    const { handler, createBooking } = createHandler(undefined, abuse);

    const response = await handler(bookingRequest());

    expect(response.status).toBe(429);
    expect(response.headers.get("retry-after")).toBe("120");
    expect(createBooking).not.toHaveBeenCalled();
  });

  it("runs one guard check before rejecting an invalid JSON body", async () => {
    const { handler, abuseCheck, createBooking } = createHandler();

    const response = await handler(bookingRequest("{not-json"));

    expect(response.status).toBe(400);
    expect(abuseCheck).toHaveBeenCalledOnce();
    expect(createBooking).not.toHaveBeenCalled();
  });

  it.each([
    [
      "human verification",
      {
        ok: false,
        status: 403,
        code: "HUMAN_VERIFICATION_REQUIRED",
      },
      403,
      "HUMAN_VERIFICATION_REQUIRED",
      null,
    ],
    [
      "rate limit",
      {
        ok: false,
        status: 429,
        code: "RATE_LIMITED",
        retryAfterSeconds: 60,
      },
      429,
      "RATE_LIMITED",
      "60",
    ],
    [
      "unavailable guard",
      { ok: false, status: 503, code: "SERVICE_UNAVAILABLE" },
      503,
      "SERVICE_UNAVAILABLE",
      null,
    ],
    [
      "malformed guard result",
      {
        ok: false,
        status: 429,
        code: "RATE_LIMITED",
        retryAfterSeconds: 0,
        clientEmail: "cliente@example.test",
      },
      503,
      "SERVICE_UNAVAILABLE",
      null,
    ],
  ] as const)(
    "rejects a %s before body or database work",
    async (_label, decision, status, code, retryAfter) => {
      const abuse = createAbuseGuard(decision);
      const { handler, createBooking } = createHandler(undefined, abuse);
      const request = bookingRequest();
      const getReader = vi.spyOn(request.body!, "getReader");

      const response = await handler(request);
      const text = await response.text();

      expect(response.status).toBe(status);
      expect(JSON.parse(text)).toEqual({ code, requestId: REQUEST_ID });
      expect(response.headers.get("retry-after")).toBe(retryAfter);
      expect(text).not.toContain("cliente@example.test");
      expect(abuse.check).toHaveBeenCalledOnce();
      expect(getReader).not.toHaveBeenCalled();
      expect(createBooking).not.toHaveBeenCalled();
    },
  );

  it("redacts a thrown guard failure before body or database work", async () => {
    const abuse = createAbuseGuard();
    abuse.check.mockRejectedValue(
      new Error("cliente@example.test 192.0.2.10 challenge-token"),
    );
    const { handler, createBooking } = createHandler(undefined, abuse);
    const request = bookingRequest();
    const getReader = vi.spyOn(request.body!, "getReader");

    const response = await handler(request);
    const text = await response.text();

    expect(response.status).toBe(503);
    expect(JSON.parse(text)).toEqual({
      code: "SERVICE_UNAVAILABLE",
      requestId: REQUEST_ID,
    });
    expect(text).not.toMatch(/cliente|192\.0\.2\.10|challenge-token/);
    expect(getReader).not.toHaveBeenCalled();
    expect(createBooking).not.toHaveBeenCalled();
  });

  it.each([
    [
      "Origin",
      bookingRequest(bookingBody, { origin: "https://attacker.test" }),
      403,
    ],
    [
      "query",
      bookingRequest(
        bookingBody,
        {},
        "https://www.gioiabeauty.net/api/bookings?unexpected=1",
      ),
      400,
    ],
    [
      "idempotency",
      bookingRequest(bookingBody, { "idempotency-key": "not-a-uuid" }),
      400,
    ],
    [
      "media",
      bookingRequest(bookingBody, { "content-type": "text/plain" }),
      415,
    ],
    [
      "declared size",
      bookingRequest(bookingBody, { "content-length": "8193" }),
      413,
    ],
  ] as const)(
    "rejects invalid %s before guard, body, or database work",
    async (_label, request, status) => {
      const { handler, abuseCheck, createBooking } = createHandler();
      const getReader = vi.spyOn(request.body!, "getReader");

      expect((await handler(request)).status).toBe(status);
      expect(abuseCheck).not.toHaveBeenCalled();
      expect(getReader).not.toHaveBeenCalled();
      expect(createBooking).not.toHaveBeenCalled();
    },
  );

  it("rejects missing, malformed, and oversized idempotency headers", async () => {
    for (const header of [
      "",
      "not-a-uuid",
      IDEMPOTENCY_KEY.toUpperCase(),
      "x".repeat(129),
    ]) {
      const { handler, createBooking } = createHandler();
      const response = await handler(
        bookingRequest(bookingBody, { "idempotency-key": header }),
      );

      expect(response.status).toBe(400);
      expect(createBooking).not.toHaveBeenCalled();
    }
  });

  it("rejects malformed JSON, wrong media type, and schema violations", async () => {
    const cases: Array<[Request, number, string]> = [
      [bookingRequest("{not-json"), 400, "INVALID_JSON"],
      [
        bookingRequest(bookingBody, { "content-type": "text/plain" }),
        415,
        "UNSUPPORTED_MEDIA_TYPE",
      ],
      [
        bookingRequest(bookingBody, { "content-type": "application/jsonp" }),
        415,
        "UNSUPPORTED_MEDIA_TYPE",
      ],
      [
        bookingRequest(bookingBody, {
          "content-type": "application/json; charset=iso-8859-1",
        }),
        415,
        "UNSUPPORTED_MEDIA_TYPE",
      ],
      [
        bookingRequest(bookingBody, { "content-encoding": "gzip" }),
        415,
        "UNSUPPORTED_MEDIA_TYPE",
      ],
      [
        bookingRequest({ ...bookingBody, startMinutes: "600" }),
        422,
        "INVALID_REQUEST",
      ],
      [
        bookingRequest({ ...bookingBody, idempotencyKey: IDEMPOTENCY_KEY }),
        422,
        "INVALID_REQUEST",
      ],
    ];

    for (const [request, status, code] of cases) {
      const { handler, createBooking } = createHandler();
      const response = await handler(request);
      expect(response.status).toBe(status);
      expect(await response.json()).toEqual({ code, requestId: REQUEST_ID });
      expect(createBooking).not.toHaveBeenCalled();
    }
  });

  it("fatally rejects invalid UTF-8 that nonfatal decoding would accept", async () => {
    const bytes = new Uint8Array(
      Buffer.from(
        JSON.stringify({ ...bookingBody, clientName: "Cliente Test" }),
      ),
    );
    const nameOffset = Buffer.from(bytes).indexOf("Cliente Test");
    expect(nameOffset).toBeGreaterThan(-1);
    bytes[nameOffset] = 0xff;

    const { handler, createBooking } = createHandler();
    const response = await handler(bookingRequest(bytes));

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({
      code: "INVALID_JSON",
      requestId: REQUEST_ID,
    });
    expect(createBooking).not.toHaveBeenCalled();
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

  it.each([
    [
      { "content-type": `application/json;${"x".repeat(65)}` },
      415,
      "UNSUPPORTED_MEDIA_TYPE",
    ],
    [{ "content-encoding": "identity,gzip" }, 415, "UNSUPPORTED_MEDIA_TYPE"],
    [{ "content-length": "8192,8192" }, 400, "INVALID_REQUEST"],
  ] as const)(
    "rejects invalid framing headers before reading the body: %j",
    async (headers, status, code) => {
      const { handler, createBooking } = createHandler();
      const request = bookingRequest(bookingBody, headers);
      const getReader = vi.spyOn(request.body!, "getReader");
      const response = await handler(request);

      expect(response.status).toBe(status);
      expect(await response.json()).toEqual({ code, requestId: REQUEST_ID });
      expect(getReader).not.toHaveBeenCalled();
      expect(createBooking).not.toHaveBeenCalled();
    },
  );

  it("applies structural, idempotency, and media failures before size framing", async () => {
    const cases = [
      [
        bookingRequest(
          bookingBody,
          {
            "idempotency-key": "",
            "content-type": "text/plain",
            "content-length": "9000",
          },
          "https://www.gioiabeauty.net/api/bookings?unexpected=1",
        ),
        "INVALID_REQUEST",
      ],
      [
        bookingRequest(bookingBody, {
          "idempotency-key": "not-a-uuid",
          "content-type": "text/plain",
          "content-length": "9000",
        }),
        "INVALID_IDEMPOTENCY_KEY",
      ],
      [
        bookingRequest(bookingBody, {
          "content-type": "text/plain",
          "content-length": "9000",
        }),
        "UNSUPPORTED_MEDIA_TYPE",
      ],
    ] as const;

    for (const [request, code] of cases) {
      const { handler, createBooking } = createHandler();
      const getReader = vi.spyOn(request.body!, "getReader");
      const response = await handler(request);
      expect(response.status).toBe(
        code === "UNSUPPORTED_MEDIA_TYPE" ? 415 : 400,
      );
      expect(await response.json()).toEqual({ code, requestId: REQUEST_ID });
      expect(getReader).not.toHaveBeenCalled();
      expect(createBooking).not.toHaveBeenCalled();
    }
  });

  it("accepts exactly 8 KiB and stops a chunked body at the next byte", async () => {
    const json = JSON.stringify(bookingBody);
    const exact = json + " ".repeat(8 * 1_024 - Buffer.byteLength(json));
    const exactFixture = createHandler();
    expect((await exactFixture.handler(bookingRequest(exact))).status).toBe(
      201,
    );
    expect(exactFixture.createBooking).toHaveBeenCalledOnce();

    const cancel = vi.fn();
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new TextEncoder().encode("x".repeat(8 * 1_024)));
        controller.enqueue(new Uint8Array([0x78]));
      },
      cancel,
    });
    const overflowFixture = createHandler();
    expect((await overflowFixture.handler(bookingRequest(stream))).status).toBe(
      413,
    );
    expect(cancel).toHaveBeenCalledOnce();
    expect(overflowFixture.createBooking).not.toHaveBeenCalled();
  });

  it("rejects query parameters before reading the body or accessing the database", async () => {
    const { handler, createBooking } = createHandler();
    const request = bookingRequest(
      bookingBody,
      {},
      "https://www.gioiabeauty.net/api/bookings?source=public",
    );
    const getReader = vi.spyOn(request.body!, "getReader");
    const response = await handler(request);

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({
      code: "INVALID_REQUEST",
      requestId: REQUEST_ID,
    });
    expect(getReader).not.toHaveBeenCalled();
    expect(createBooking).not.toHaveBeenCalled();
  });

  it.each([
    "",
    "https://attacker.test",
    "https://www.gioiabeauty.net/path",
    `https://${"a".repeat(500)}.test`,
  ])(
    "rejects noncanonical or cross-origin header %j before parsing or database access",
    async (origin) => {
      const { handler, createBooking } = createHandler();
      const request = bookingRequest(bookingBody, { origin });
      const getReader = vi.spyOn(request.body!, "getReader");
      const response = await handler(request);

      expect(response.status).toBe(403);
      expect(getReader).not.toHaveBeenCalled();
      expect(createBooking).not.toHaveBeenCalled();
    },
  );

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

  it.each([
    ["IDEMPOTENCY_KEY_REUSED", 409, "IDEMPOTENCY_KEY_REUSED"],
    ["COMMAND_IN_PROGRESS", 409, "COMMAND_IN_PROGRESS"],
    ["UNKNOWN_cliente@example.test", 503, "SERVICE_UNAVAILABLE"],
  ])(
    "maps thrown database code %s to a redacted response",
    async (message, expectedStatus, expectedCode) => {
      const createBooking = vi
        .fn<CreateBookingFunction>()
        .mockRejectedValue(
          Object.assign(new Error(message), { code: "PT409" }),
        );
      const { handler } = createHandler(createBooking);
      const response = await handler(bookingRequest());
      const text = await response.text();

      expect(response.status).toBe(expectedStatus);
      expect(JSON.parse(text)).toEqual({
        code: expectedCode,
        requestId: REQUEST_ID,
      });
      expect(text).not.toContain("cliente@example.test");
      expect(createBooking).toHaveBeenCalledTimes(1);
    },
  );

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

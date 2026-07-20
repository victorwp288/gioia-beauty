import { afterEach, describe, expect, it, vi } from "vitest";

import {
  bookingErrorInvalidatesSelection,
  catalogSelection,
  ClientApiError,
  createPublicBooking,
  getPublicAvailability,
  salonDateFromLocalDate,
  shouldRetainPublicIdempotencyKey,
  startMinutesFromTime,
  subscribeToNewsletter,
  timeFromStartMinutes,
} from "@/lib/client/publicApi.ts";
import { SERVICE_CATALOG } from "@/lib/domain/catalog/index.ts";

const REQUEST_ID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const IDEMPOTENCY_KEY = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const RESOURCE_ID = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";

afterEach(() => {
  vi.unstubAllGlobals();
});

function jsonResponse(body: unknown, init: ResponseInit = {}) {
  return new Response(JSON.stringify(body), {
    ...init,
    headers: { "Content-Type": "application/json", ...init.headers },
  });
}

describe("public API client conversions", () => {
  it("uses local calendar fields and validates minute conversions", () => {
    expect(salonDateFromLocalDate(new Date(2026, 6, 20, 23, 59))).toBe(
      "2026-07-20",
    );
    expect(startMinutesFromTime("09:45")).toBe(585);
    expect(timeFromStartMinutes(585)).toBe("09:45");
    expect(() => startMinutesFromTime("24:00")).toThrow(TypeError);
    expect(() => timeFromStartMinutes(1_440)).toThrow(TypeError);
  });

  it("maps every active catalog variant back to its canonical IDs", () => {
    for (const service of SERVICE_CATALOG.services.filter(
      (candidate) => candidate.active,
    )) {
      for (const variant of service.variants.filter(
        (candidate) => candidate.active,
      )) {
        expect(
          catalogSelection(service.nameIt, variant.serviceDurationMinutes),
        ).toMatchObject({ serviceId: service.id, variantId: variant.id });
      }
    }
    expect(catalogSelection("Servizio inesistente", 60)).toBeNull();
  });
});

describe("public API client HTTP contracts", () => {
  it("requests uncached, abortable availability and validates the response", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      jsonResponse({
        date: "2026-08-10",
        serviceId: "manicure",
        variantId: "manicure-30-min",
        slots: [540, 555],
      }),
    );
    vi.stubGlobal("fetch", fetchMock);
    const controller = new AbortController();

    await expect(
      getPublicAvailability(
        {
          date: "2026-08-10",
          serviceId: "manicure",
          variantId: "manicure-30-min",
        },
        controller.signal,
      ),
    ).resolves.toMatchObject({ slots: [540, 555] });

    expect(fetchMock).toHaveBeenCalledWith(
      "/api/availability?date=2026-08-10&serviceId=manicure&variantId=manicure-30-min",
      expect.objectContaining({
        cache: "no-store",
        credentials: "same-origin",
        method: "GET",
        signal: controller.signal,
      }),
    );
  });

  it("sends the exact booking command and idempotency header", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(
        jsonResponse(
          { code: "BOOKING_CREATED", resourceId: RESOURCE_ID, replayed: false },
          { status: 201 },
        ),
      );
    vi.stubGlobal("fetch", fetchMock);
    const command = {
      date: "2026-08-10",
      startMinutes: 600,
      serviceId: "manicure",
      variantId: "manicure-30-min",
      clientName: "Cliente Test",
      clientEmail: "cliente@example.test",
      clientPhone: "+39000000000",
      clientNote: null,
    };

    await expect(
      createPublicBooking(command, IDEMPOTENCY_KEY),
    ).resolves.toMatchObject({ code: "BOOKING_CREATED", replayed: false });
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/bookings",
      expect.objectContaining({
        body: JSON.stringify(command),
        credentials: "same-origin",
        headers: expect.objectContaining({
          "Content-Type": "application/json",
          "Idempotency-Key": IDEMPOTENCY_KEY,
        }),
        method: "POST",
      }),
    );
  });

  it("sends normalized newsletter consent through the command endpoint", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(jsonResponse({ code: "REQUEST_ACCEPTED" }));
    vi.stubGlobal("fetch", fetchMock);

    await subscribeToNewsletter("cliente@example.test", IDEMPOTENCY_KEY);

    expect(fetchMock).toHaveBeenCalledWith(
      "/api/newsletter/subscribe",
      expect.objectContaining({
        body: JSON.stringify({
          email: "cliente@example.test",
          consent: true,
        }),
        headers: expect.objectContaining({
          "Idempotency-Key": IDEMPOTENCY_KEY,
        }),
        method: "POST",
      }),
    );
  });

  it("preserves validated error metadata including bounded Retry-After", async () => {
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockResolvedValue(
          jsonResponse(
            { code: "RATE_LIMITED", requestId: REQUEST_ID },
            { status: 429, headers: { "Retry-After": "90" } },
          ),
        ),
    );

    const error = await getPublicAvailability({
      date: "2026-08-10",
      serviceId: "manicure",
      variantId: "manicure-30-min",
    }).catch((cause) => cause);

    expect(error).toBeInstanceOf(ClientApiError);
    expect(error).toMatchObject({
      code: "RATE_LIMITED",
      requestId: REQUEST_ID,
      retryAfterSeconds: 90,
      status: 429,
    });
  });

  it("wraps network failures but preserves AbortError cancellation", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("offline")));
    await expect(
      getPublicAvailability({
        date: "2026-08-10",
        serviceId: "manicure",
        variantId: "manicure-30-min",
      }),
    ).rejects.toMatchObject({ code: "NETWORK_ERROR", status: 0 });

    const abortError = new DOMException("aborted", "AbortError");
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(abortError));
    await expect(
      getPublicAvailability({
        date: "2026-08-10",
        serviceId: "manicure",
        variantId: "manicure-30-min",
      }),
    ).rejects.toBe(abortError);
  });

  it("rejects malformed successful payloads", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(jsonResponse({ slots: [] })),
    );
    await expect(
      getPublicAvailability({
        date: "2026-08-10",
        serviceId: "manicure",
        variantId: "manicure-30-min",
      }),
    ).rejects.toMatchObject({ code: "INVALID_RESPONSE", status: 200 });
  });
});

describe("public command retry policy", () => {
  it.each([
    new ClientApiError(0, "NETWORK_ERROR"),
    new ClientApiError(409, "COMMAND_IN_PROGRESS"),
    new ClientApiError(429, "RATE_LIMITED"),
    new ClientApiError(503, "SERVICE_UNAVAILABLE"),
    new Error("unknown transport failure"),
  ])("retains the idempotency key for ambiguous failure %#", (error) => {
    expect(shouldRetainPublicIdempotencyKey(error)).toBe(true);
  });

  it.each([
    new ClientApiError(409, "SLOT_UNAVAILABLE"),
    new ClientApiError(400, "PUBLIC_CONTACT_INVALID"),
    new ClientApiError(409, "IDEMPOTENCY_KEY_REUSED"),
  ])("rotates the idempotency key after deterministic failure %#", (error) => {
    expect(shouldRetainPublicIdempotencyKey(error)).toBe(false);
  });

  it("invalidates stale slot selections without treating all 409s as stale", () => {
    expect(
      bookingErrorInvalidatesSelection(
        new ClientApiError(409, "SLOT_UNAVAILABLE"),
      ),
    ).toBe(true);
    expect(
      bookingErrorInvalidatesSelection(
        new ClientApiError(409, "COMMAND_IN_PROGRESS"),
      ),
    ).toBe(false);
  });
});

import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const availabilityGet = vi.hoisted(() => vi.fn());
const bookingPost = vi.hoisted(() => vi.fn());
const ownerLoginPost = vi.hoisted(() =>
  vi.fn(async () => new Response(null, { status: 204 })),
);
const abuseGuard = vi.hoisted(() => ({ check: vi.fn() }));
const database = vi.hoisted(() => ({}));
const ownerAuthRepository = vi.hoisted(() => ({
  startSession: vi.fn(),
  revokeSession: vi.fn(),
}));
const ownerAuthContext = vi.hoisted(() => ({
  auth: {},
  securityCookieStore: {},
  secure: true,
  responseHeaders: new Headers({ "x-auth-refresh": "applied" }),
}));
const createAvailabilityHandler = vi.hoisted(() =>
  vi.fn(() => availabilityGet),
);
const createBookingHandler = vi.hoisted(() => vi.fn(() => bookingPost));
const createOwnerLoginHandler = vi.hoisted(() => vi.fn(() => ownerLoginPost));
const createNextOwnerAuthContext = vi.hoisted(() =>
  vi.fn(async () => ownerAuthContext),
);
const clearOwnerSecurityCookies = vi.hoisted(() => vi.fn());
const writeOwnerSecurityCookies = vi.hoisted(() => vi.fn());
const observeRoute = vi.hoisted(() =>
  vi.fn((_route: string, _method: string, handler: unknown) => handler),
);

vi.mock("@/lib/server/publicAbuseBoundary.ts", () => ({
  publicAbuseGuard: abuseGuard,
}));
vi.mock("@/lib/server/database/publicBookingRepository.ts", () => ({
  publicBookingRepository: database,
}));
vi.mock("@/lib/server/database/ownerAuthRepository.ts", () => ({
  ownerAuthRepository,
}));
vi.mock("@/lib/server/availabilityHandler.ts", () => ({
  createAvailabilityGetHandler: createAvailabilityHandler,
}));
vi.mock("@/lib/server/publicBookingHandler.ts", () => ({
  createPublicBookingPostHandler: createBookingHandler,
}));
vi.mock("@/lib/server/auth/ownerAuthHandlers.ts", () => ({
  createOwnerLoginHandler,
}));
vi.mock("@/lib/server/auth/nextOwnerAuthContext.ts", () => ({
  createNextOwnerAuthContext,
}));
vi.mock("@/lib/server/auth/ownerSecurityCookies.ts", () => ({
  clearOwnerSecurityCookies,
  writeOwnerSecurityCookies,
}));
vi.mock("@/lib/server/observability/runtime", () => ({
  observeServerRoute: observeRoute,
}));

describe("public abuse route wiring", () => {
  it("binds both public database routes to the guarded singleton", async () => {
    vi.resetModules();
    const availability = await import("@/app/api/availability/route.ts");
    const bookings = await import("@/app/api/bookings/route.ts");

    expect(availability.dynamic).toBe("force-dynamic");
    expect(availability.runtime).toBe("nodejs");
    expect(createAvailabilityHandler).toHaveBeenCalledOnce();
    expect(createAvailabilityHandler).toHaveBeenCalledWith({
      abuseGuard,
      database,
    });
    expect(observeRoute).toHaveBeenCalledWith(
      "public.availability",
      "GET",
      availabilityGet,
    );
    expect(availability.GET).toBe(availabilityGet);

    expect(bookings.dynamic).toBe("force-dynamic");
    expect(bookings.runtime).toBe("nodejs");
    expect(createBookingHandler).toHaveBeenCalledOnce();
    expect(createBookingHandler).toHaveBeenCalledWith({
      abuseGuard,
      database,
    });
    expect(observeRoute).toHaveBeenCalledWith(
      "public.booking",
      "POST",
      bookingPost,
    );
    expect(bookings.POST).toBe(bookingPost);
  });

  it("binds owner login to the same durable guarded singleton", async () => {
    vi.resetModules();
    const login = await import("@/app/api/auth/login/route.ts");
    const request = new Request("https://app.example.test/api/auth/login", {
      method: "POST",
    });

    await expect(login.POST(request)).resolves.toHaveProperty("status", 204);

    expect(login.dynamic).toBe("force-dynamic");
    expect(login.runtime).toBe("nodejs");
    expect(createOwnerLoginHandler).toHaveBeenCalledWith(
      expect.objectContaining({
        auth: ownerAuthContext.auth,
        abuseGuard,
        startSession: ownerAuthRepository.startSession,
        revokeSession: ownerAuthRepository.revokeSession,
        responseHeaders: ownerAuthContext.responseHeaders,
      }),
    );
    expect(observeRoute).toHaveBeenCalledWith(
      "auth.login",
      "POST",
      expect.any(Function),
    );
    expect(ownerLoginPost).toHaveBeenCalledWith(request);
  });
});

import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const availabilityGet = vi.hoisted(() => vi.fn());
const bookingPost = vi.hoisted(() => vi.fn());
const abuseGuard = vi.hoisted(() => ({ check: vi.fn() }));
const database = vi.hoisted(() => ({}));
const createAvailabilityHandler = vi.hoisted(() =>
  vi.fn(() => availabilityGet),
);
const createBookingHandler = vi.hoisted(() => vi.fn(() => bookingPost));

vi.mock("@/lib/server/publicAbuseBoundary.ts", () => ({
  publicAbuseGuard: abuseGuard,
}));
vi.mock("@/lib/server/database/publicBookingRepository.ts", () => ({
  publicBookingRepository: database,
}));
vi.mock("@/lib/server/availabilityHandler.ts", () => ({
  createAvailabilityGetHandler: createAvailabilityHandler,
}));
vi.mock("@/lib/server/publicBookingHandler.ts", () => ({
  createPublicBookingPostHandler: createBookingHandler,
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
    expect(availability.GET).toBe(availabilityGet);

    expect(bookings.dynamic).toBe("force-dynamic");
    expect(bookings.runtime).toBe("nodejs");
    expect(createBookingHandler).toHaveBeenCalledOnce();
    expect(createBookingHandler).toHaveBeenCalledWith({
      abuseGuard,
      database,
    });
    expect(bookings.POST).toBe(bookingPost);
  });
});

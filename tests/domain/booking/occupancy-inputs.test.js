import { describe, expect, it } from "vitest";

import {
  asActiveBookingVariant,
  asValidatedBlockOccupancy,
} from "@/lib/domain/booking";

const resolvedVariant = (overrides = {}) => ({
  serviceId: "trattamento-viso",
  variantId: "trattamento-viso-60",
  serviceActive: true,
  variantActive: true,
  serviceDurationMinutes: 60,
  bufferMinutes: 5,
  ...overrides,
});

describe("authoritative occupancy inputs", () => {
  it("brands a validated active server-resolved service variant", () => {
    expect(asActiveBookingVariant(resolvedVariant())).toEqual({
      serviceId: "trattamento-viso",
      variantId: "trattamento-viso-60",
      serviceDurationMinutes: 60,
      bufferMinutes: 5,
      active: true,
    });
  });

  it.each([
    ["inactive service", { serviceActive: false }],
    ["inactive variant", { variantActive: false }],
    ["invalid service ID", { serviceId: "Trattamento viso" }],
    ["invalid variant ID", { variantId: "" }],
    ["invalid duration", { serviceDurationMinutes: 0 }],
    ["invalid buffer", { bufferMinutes: 121 }],
  ])("rejects an %s", (_name, overrides) => {
    expect(() => asActiveBookingVariant(resolvedVariant(overrides))).toThrow();
  });

  it("keeps owner block duration validation on a separate path", () => {
    expect(
      asValidatedBlockOccupancy({ durationMinutes: 45, bufferMinutes: 10 }),
    ).toEqual({ durationMinutes: 45, bufferMinutes: 10 });
    expect(() =>
      asValidatedBlockOccupancy({ durationMinutes: 0, bufferMinutes: 0 }),
    ).toThrow(RangeError);
  });
});

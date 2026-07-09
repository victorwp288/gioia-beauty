import { describe, expect, it } from "vitest";

import {
  DEFAULT_BOOKING_POLICY,
  DEFAULT_BUSINESS_HOURS,
  DEFAULT_OWNER_BOOKING_POLICY,
  asActiveBookingVariant,
  asBufferMinutes,
  asDurationMinutes,
  asMinuteOfDay,
  asSalonDate,
  asValidatedBlockOccupancy,
  availableOwnerAppointmentStartMinutes,
  availableOwnerBlockStartMinutes,
  isOwnerAppointmentStartAvailable,
  isOwnerBlockStartAvailable,
  isPublicAppointmentStartAvailable,
  ownerBookingViolation,
} from "@/lib/domain/booking";

const duration = (minutes) => asDurationMinutes(minutes);
const buffer = (minutes) => asBufferMinutes(minutes);
const start = (minutes) => asMinuteOfDay(minutes);

const variant = asActiveBookingVariant({
  serviceId: "manicure",
  variantId: "manicure-classica",
  serviceActive: true,
  variantActive: true,
  serviceDurationMinutes: 30,
  bufferMinutes: 0,
});
const block = asValidatedBlockOccupancy({
  durationMinutes: 30,
  bufferMinutes: 0,
});

describe("owner booking policy", () => {
  const date = asSalonDate("2026-07-13");
  const now = new Date("2026-07-13T08:00:00Z");

  it("allows a future start today without applying the public 60-day window", () => {
    expect(
      ownerBookingViolation({
        date,
        startMinutes: start(660),
        now,
        policy: DEFAULT_OWNER_BOOKING_POLICY,
      }),
    ).toBeNull();
    expect(
      ownerBookingViolation({
        date: asSalonDate("2026-10-01"),
        startMinutes: start(600),
        now,
        policy: DEFAULT_OWNER_BOOKING_POLICY,
      }),
    ).toBeNull();
  });

  it("rejects past dates, past starts today, and misalignment", () => {
    expect(
      ownerBookingViolation({
        date: asSalonDate("2026-07-12"),
        startMinutes: start(660),
        now,
        policy: DEFAULT_OWNER_BOOKING_POLICY,
      }),
    ).toBe("past_date");
    expect(
      ownerBookingViolation({
        date,
        startMinutes: start(585),
        now,
        policy: DEFAULT_OWNER_BOOKING_POLICY,
      }),
    ).toBe("past_start");
    expect(
      ownerBookingViolation({
        date,
        startMinutes: start(667),
        now,
        policy: DEFAULT_OWNER_BOOKING_POLICY,
      }),
    ).toBe("misaligned_start");
  });
});

describe("owner appointment availability", () => {
  const date = asSalonDate("2026-07-13");
  const now = new Date("2026-07-13T08:00:00Z");
  const base = {
    date,
    variant,
    entries: [],
    vacations: [],
    now,
    businessHours: DEFAULT_BUSINESS_HOURS,
  };

  it("exposes today to the owner while the public path remains closed", () => {
    expect(
      isOwnerAppointmentStartAvailable({
        ...base,
        startMinutes: start(660),
        policy: DEFAULT_OWNER_BOOKING_POLICY,
      }),
    ).toBe(true);
    expect(
      isPublicAppointmentStartAvailable({
        ...base,
        startMinutes: start(660),
        policy: DEFAULT_BOOKING_POLICY,
      }),
    ).toBe(false);
  });

  it("keeps future owner availability outside the public 60-day window", () => {
    const futureInput = {
      ...base,
      date: asSalonDate("2026-10-01"),
      startMinutes: start(600),
    };
    expect(
      isOwnerAppointmentStartAvailable({
        ...futureInput,
        policy: DEFAULT_OWNER_BOOKING_POLICY,
      }),
    ).toBe(true);
    expect(
      isPublicAppointmentStartAvailable({
        ...futureInput,
        policy: DEFAULT_BOOKING_POLICY,
      }),
    ).toBe(false);
  });

  it("supports rescheduling self without ignoring another conflict", () => {
    const entries = [
      {
        id: "self",
        kind: "appointment",
        status: "confirmed",
        date,
        startMinutes: start(660),
        serviceDurationMinutes: duration(30),
        bufferMinutes: buffer(0),
      },
      {
        id: "other",
        kind: "appointment",
        status: "confirmed",
        date,
        startMinutes: start(720),
        serviceDurationMinutes: duration(30),
        bufferMinutes: buffer(0),
      },
    ];
    const starts = availableOwnerAppointmentStartMinutes({
      ...base,
      entries,
      excludeEntryId: "self",
      policy: DEFAULT_OWNER_BOOKING_POLICY,
    });

    expect(starts).toContain(660);
    expect(starts).not.toContain(720);
  });
});

describe("owner block availability", () => {
  const date = asSalonDate("2026-07-13");
  const now = new Date("2026-07-13T08:00:00Z");
  const base = {
    date,
    block,
    entries: [],
    vacations: [],
    now,
    policy: DEFAULT_OWNER_BOOKING_POLICY,
    businessHours: DEFAULT_BUSINESS_HOURS,
  };

  it("uses the dedicated block path and returns aligned future starts today", () => {
    const starts = availableOwnerBlockStartMinutes(base);
    expect(starts.at(0)).toBe(600);
    expect(starts).toContain(660);
    expect(starts.every((minute) => minute % 15 === 0)).toBe(true);
  });

  it("never overrides vacations, business hours, alignment, or overlap", () => {
    const vacation = { status: "active", startDate: date, endDate: date };
    const conflictingEntry = {
      id: "appointment",
      kind: "appointment",
      status: "confirmed",
      date,
      startMinutes: start(660),
      serviceDurationMinutes: duration(30),
      bufferMinutes: buffer(0),
    };

    expect(
      isOwnerBlockStartAvailable({
        ...base,
        startMinutes: start(660),
        vacations: [vacation],
      }),
    ).toBe(false);
    expect(
      isOwnerBlockStartAvailable({ ...base, startMinutes: start(530) }),
    ).toBe(false);
    expect(
      isOwnerBlockStartAvailable({ ...base, startMinutes: start(667) }),
    ).toBe(false);
    expect(
      isOwnerBlockStartAvailable({
        ...base,
        startMinutes: start(660),
        entries: [conflictingEntry],
      }),
    ).toBe(false);
  });
});

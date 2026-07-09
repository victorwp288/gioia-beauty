import { describe, expect, it } from "vitest";

import {
  DEFAULT_BOOKING_POLICY,
  DEFAULT_BUSINESS_HOURS,
  asActiveBookingVariant,
  asBufferMinutes,
  asDurationMinutes,
  asMinuteOfDay,
  asSalonDate,
  availablePublicAppointmentStartMinutes,
  isDateOnActiveVacation,
  isPublicAppointmentStartAvailable,
  publicBookingViolation,
} from "@/lib/domain/booking";

const duration = (minutes) => asDurationMinutes(minutes);
const buffer = (minutes) => asBufferMinutes(minutes);
const start = (minutes) => asMinuteOfDay(minutes);

function activeVariant(overrides = {}) {
  return asActiveBookingVariant({
    serviceId: "manicure",
    variantId: "manicure-classica",
    serviceActive: true,
    variantActive: true,
    serviceDurationMinutes: 30,
    bufferMinutes: 0,
    ...overrides,
  });
}

describe("public booking policy", () => {
  const monday = asSalonDate("2026-07-06");
  const romeMonday0030 = new Date("2026-07-05T22:30:00Z");

  it("rejects same-day public booking and past salon dates", () => {
    expect(
      publicBookingViolation({
        date: monday,
        startMinutes: start(600),
        now: romeMonday0030,
        policy: DEFAULT_BOOKING_POLICY,
      }),
    ).toBe("same_day_not_allowed");
    expect(
      publicBookingViolation({
        date: asSalonDate("2026-07-05"),
        startMinutes: start(600),
        now: romeMonday0030,
        policy: DEFAULT_BOOKING_POLICY,
      }),
    ).toBe("past_date");
  });

  it("treats the 60-day advance boundary as inclusive", () => {
    const now = new Date("2026-07-01T08:00:00Z");
    expect(
      publicBookingViolation({
        date: asSalonDate("2026-08-30"),
        startMinutes: start(600),
        now,
        policy: DEFAULT_BOOKING_POLICY,
      }),
    ).toBeNull();
    expect(
      publicBookingViolation({
        date: asSalonDate("2026-08-31"),
        startMinutes: start(600),
        now,
        policy: DEFAULT_BOOKING_POLICY,
      }),
    ).toBe("beyond_max_advance");
  });

  it("enforces alignment and an exact instant-based lead boundary", () => {
    const now = new Date("2026-07-06T08:00:00Z");
    const policy = {
      ...DEFAULT_BOOKING_POLICY,
      sameDayAllowed: true,
      minimumLeadMinutes: 30,
    };

    expect(
      publicBookingViolation({
        date: monday,
        startMinutes: start(615),
        now,
        policy,
      }),
    ).toBe("minimum_lead_time");
    expect(
      publicBookingViolation({
        date: monday,
        startMinutes: start(630),
        now,
        policy,
      }),
    ).toBeNull();
    expect(
      publicBookingViolation({
        date: monday,
        startMinutes: start(637),
        now,
        policy,
      }),
    ).toBe("misaligned_start");
  });

  it("requires explicit policy and a valid injected instant", () => {
    expect(() =>
      publicBookingViolation({
        date: monday,
        startMinutes: start(600),
        now: romeMonday0030,
      }),
    ).toThrow(/policy is required/);
    expect(() =>
      publicBookingViolation({
        date: monday,
        startMinutes: start(600),
        now: new Date(Number.NaN),
        policy: DEFAULT_BOOKING_POLICY,
      }),
    ).toThrow(RangeError);
  });
});

describe("vacations", () => {
  const activeVacation = {
    status: "active",
    startDate: asSalonDate("2026-08-10"),
    endDate: asSalonDate("2026-08-14"),
  };
  const cancelledVacation = { ...activeVacation, status: "cancelled" };

  it("uses inclusive boundaries and ignores cancelled vacations", () => {
    expect(
      isDateOnActiveVacation(asSalonDate("2026-08-10"), [activeVacation]),
    ).toBe(true);
    expect(
      isDateOnActiveVacation(asSalonDate("2026-08-14"), [activeVacation]),
    ).toBe(true);
    expect(
      isDateOnActiveVacation(asSalonDate("2026-08-15"), [activeVacation]),
    ).toBe(false);
    expect(
      isDateOnActiveVacation(asSalonDate("2026-08-12"), [cancelledVacation]),
    ).toBe(false);
  });
});

describe("public appointment availability", () => {
  const date = asSalonDate("2026-07-13");
  const now = new Date("2026-07-01T08:00:00Z");
  const makeEntry = (overrides = {}) => ({
    id: "entry",
    kind: "appointment",
    status: "confirmed",
    date,
    startMinutes: start(600),
    serviceDurationMinutes: duration(30),
    bufferMinutes: buffer(0),
    ...overrides,
  });
  const makeInput = (overrides = {}) => ({
    date,
    variant: activeVariant(),
    entries: [],
    vacations: [],
    now,
    policy: DEFAULT_BOOKING_POLICY,
    businessHours: DEFAULT_BUSINESS_HOURS,
    ...overrides,
  });

  it("filters partial conflicts while retaining adjacent starts", () => {
    const starts = availablePublicAppointmentStartMinutes(
      makeInput({ entries: [makeEntry()] }),
    );

    expect(starts).toContain(570);
    expect(starts).not.toContain(585);
    expect(starts).not.toContain(600);
    expect(starts).not.toContain(615);
    expect(starts).toContain(630);
  });

  it("blocks active owner blocks but ignores cancelled and no-show records", () => {
    const entries = [
      makeEntry({
        id: "block",
        kind: "block",
        status: "active",
        startMinutes: start(660),
      }),
      makeEntry({
        id: "cancelled",
        status: "cancelled",
        startMinutes: start(720),
      }),
      makeEntry({ id: "no-show", status: "no_show", startMinutes: start(780) }),
    ];
    const starts = availablePublicAppointmentStartMinutes(
      makeInput({ entries }),
    );

    expect(starts).not.toContain(660);
    expect(starts).toContain(720);
    expect(starts).toContain(780);
  });

  it("uses the authoritative variant buffer in conflict checks", () => {
    expect(
      isPublicAppointmentStartAvailable(
        makeInput({
          startMinutes: start(540),
          variant: activeVariant({ bufferMinutes: 15 }),
          entries: [makeEntry({ startMinutes: start(580) })],
        }),
      ),
    ).toBe(false);
  });

  it("returns no starts for a vacation or a closed day", () => {
    const vacation = {
      status: "active",
      startDate: date,
      endDate: date,
    };
    expect(
      availablePublicAppointmentStartMinutes(
        makeInput({ vacations: [vacation] }),
      ),
    ).toEqual([]);
    expect(
      availablePublicAppointmentStartMinutes(
        makeInput({ date: asSalonDate("2026-07-12") }),
      ),
    ).toEqual([]);
  });
});

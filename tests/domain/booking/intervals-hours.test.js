import { describe, expect, it } from "vitest";

import {
  DEFAULT_BUSINESS_HOURS,
  asBufferMinutes,
  asDurationMinutes,
  asMinuteOfDay,
  asSalonDate,
  businessHoursForDate,
  entryConsumesAvailability,
  entryConflictsWith,
  generateBusinessStarts,
  intervalFitsBusinessHours,
  intervalsOverlap,
  occupiedInterval,
} from "@/lib/domain/booking";

const date = asSalonDate("2026-07-06");
const duration = (minutes) => asDurationMinutes(minutes);
const buffer = (minutes) => asBufferMinutes(minutes);
const start = (minutes) => asMinuteOfDay(minutes);

describe("occupied intervals", () => {
  it("adds the post-service buffer to the occupied half-open range", () => {
    expect(occupiedInterval(start(600), duration(45), buffer(5))).toEqual({
      start: 600,
      end: 650,
    });
  });

  it("rejects occupancy beyond the local calendar day", () => {
    expect(() =>
      occupiedInterval(start(1430), duration(15), buffer(0)),
    ).toThrow(RangeError);
  });

  it.each([
    ["exact", [600, 660], [600, 660], true],
    ["partial right", [600, 660], [650, 700], true],
    ["partial left", [600, 660], [550, 610], true],
    ["contained", [600, 700], [620, 660], true],
    ["adjacent right", [600, 660], [660, 700], false],
    ["adjacent left", [600, 660], [540, 600], false],
  ])("detects %s overlap", (_name, left, right, expected) => {
    expect(
      intervalsOverlap(
        { start: left[0], end: left[1] },
        { start: right[0], end: right[1] },
      ),
    ).toBe(expected);
  });
});

describe("business hours", () => {
  it("requires an explicit authoritative schedule", () => {
    expect(() => businessHoursForDate(date)).toThrow(/schedule is required/);
  });

  it("uses the reviewed weekday schedule and closes weekends", () => {
    expect(businessHoursForDate(date, DEFAULT_BUSINESS_HOURS)).toEqual([
      { start: 540, end: 1140 },
    ]);
    expect(
      businessHoursForDate(asSalonDate("2026-07-07"), DEFAULT_BUSINESS_HOURS),
    ).toEqual([{ start: 600, end: 1200 }]);
    expect(
      businessHoursForDate(asSalonDate("2026-07-10"), DEFAULT_BUSINESS_HOURS),
    ).toEqual([{ start: 540, end: 1110 }]);
    expect(
      businessHoursForDate(asSalonDate("2026-07-11"), DEFAULT_BUSINESS_HOURS),
    ).toEqual([]);
    expect(
      businessHoursForDate(asSalonDate("2026-07-12"), DEFAULT_BUSINESS_HOURS),
    ).toEqual([]);
  });

  it("accepts an exact closing boundary and rejects one minute beyond it", () => {
    expect(
      intervalFitsBusinessHours(
        occupiedInterval(start(1080), duration(55), buffer(5)),
        businessHoursForDate(date, DEFAULT_BUSINESS_HOURS),
      ),
    ).toBe(true);
    expect(
      intervalFitsBusinessHours(
        occupiedInterval(start(1081), duration(55), buffer(5)),
        businessHoursForDate(date, DEFAULT_BUSINESS_HOURS),
      ),
    ).toBe(false);
  });

  it("generates only aligned starts whose service and buffer fit", () => {
    const starts = generateBusinessStarts({
      date,
      serviceDurationMinutes: duration(60),
      bufferMinutes: buffer(5),
      alignmentMinutes: 15,
      businessHours: DEFAULT_BUSINESS_HOURS,
    });

    expect(starts.at(0)).toBe(540);
    expect(starts.at(-1)).toBe(1065);
    expect(starts).toHaveLength(36);
    expect(starts.every((minute) => minute % 15 === 0)).toBe(true);
  });

  it("supports separated hours without allowing occupancy across a closure", () => {
    const splitHours = {
      ...DEFAULT_BUSINESS_HOURS,
      1: [
        { start: 540, end: 720 },
        { start: 840, end: 1080 },
      ],
    };
    const starts = generateBusinessStarts({
      date,
      serviceDurationMinutes: duration(60),
      bufferMinutes: buffer(0),
      alignmentMinutes: 15,
      businessHours: splitHours,
    });

    expect(starts).toContain(660);
    expect(starts).not.toContain(675);
    expect(starts).not.toContain(720);
    expect(starts).toContain(840);
  });
});

describe("schedule entries", () => {
  const appointment = {
    id: "appointment",
    kind: "appointment",
    status: "confirmed",
    date,
    startMinutes: start(600),
    serviceDurationMinutes: duration(30),
    bufferMinutes: buffer(0),
  };

  it.each([
    [
      "confirmed appointment",
      { kind: "appointment", status: "confirmed" },
      true,
    ],
    [
      "completed appointment",
      { kind: "appointment", status: "completed" },
      true,
    ],
    ["no-show appointment", { kind: "appointment", status: "no_show" }, false],
    [
      "cancelled appointment",
      { kind: "appointment", status: "cancelled" },
      false,
    ],
    ["active block", { kind: "block", status: "active" }, true],
    ["cancelled block", { kind: "block", status: "cancelled" }, false],
  ])("classifies a %s", (_name, entry, expected) => {
    expect(entryConsumesAvailability(entry)).toBe(expected);
  });

  it("fails closed for an unknown kind or status", () => {
    expect(() =>
      entryConsumesAvailability({ kind: "appointment", status: "pending" }),
    ).toThrow(/not recognized/);
    expect(() =>
      entryConsumesAvailability({ kind: "hold", status: "active" }),
    ).toThrow(/not recognized/);
  });

  it("matches the database consuming-status overlap rule", () => {
    expect(
      entryConflictsWith(
        occupiedInterval(start(615), duration(30), buffer(0)),
        date,
        appointment,
      ),
    ).toBe(true);
    expect(
      entryConflictsWith(
        occupiedInterval(start(630), duration(30), buffer(0)),
        date,
        appointment,
      ),
    ).toBe(false);
    expect(
      entryConflictsWith(
        occupiedInterval(start(600), duration(30), buffer(0)),
        asSalonDate("2026-07-07"),
        appointment,
      ),
    ).toBe(false);
  });
});

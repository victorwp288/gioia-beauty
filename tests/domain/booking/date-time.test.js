import { describe, expect, it } from "vitest";

import {
  addSalonDays,
  asBufferMinutes,
  asDurationMinutes,
  asMinuteBoundary,
  asMinuteOfDay,
  asSalonDate,
  daysBetweenSalonDates,
  formatMinuteOfDay,
  isoWeekday,
  romeClock,
  romeDate,
  romeLocalToInstant,
} from "@/lib/domain/booking";

describe("salon-local primitives", () => {
  it("accepts real ISO calendar dates and rejects normalized or impossible dates", () => {
    expect(asSalonDate("2024-02-29")).toBe("2024-02-29");
    expect(() => asSalonDate("2025-02-29")).toThrow(RangeError);
    expect(() => asSalonDate("2026-2-09")).toThrow(RangeError);
    expect(() => asSalonDate("2026-02-09T00:00:00Z")).toThrow(RangeError);
    expect(() => asSalonDate(20260709)).toThrow(TypeError);
  });

  it("validates start, boundary, duration, and buffer minute domains", () => {
    expect(asMinuteOfDay(0)).toBe(0);
    expect(asMinuteOfDay(1439)).toBe(1439);
    expect(asMinuteBoundary(1440)).toBe(1440);
    expect(asDurationMinutes(480)).toBe(480);
    expect(asBufferMinutes(0)).toBe(0);
    expect(asBufferMinutes(120)).toBe(120);

    for (const invalid of [-1, 1.5, Number.NaN, 1440]) {
      expect(() => asMinuteOfDay(invalid)).toThrow();
    }
    expect(() => asDurationMinutes(0)).toThrow(RangeError);
    expect(() => asDurationMinutes(481)).toThrow(RangeError);
    expect(() => asBufferMinutes(121)).toThrow(RangeError);
  });

  it("formats minutes and performs timezone-independent calendar arithmetic", () => {
    expect(formatMinuteOfDay(asMinuteOfDay(0))).toBe("00:00");
    expect(formatMinuteOfDay(asMinuteOfDay(1439))).toBe("23:59");

    const leapDay = asSalonDate("2024-02-29");
    expect(addSalonDays(leapDay, 1)).toBe("2024-03-01");
    expect(addSalonDays(asSalonDate("2024-02-28"), 1)).toBe(leapDay);
    expect(daysBetweenSalonDates(leapDay, asSalonDate("2024-03-02"))).toBe(2);
    expect(daysBetweenSalonDates(asSalonDate("2024-03-02"), leapDay)).toBe(-2);
  });

  it("derives ISO weekdays from the salon calendar date", () => {
    expect(isoWeekday(asSalonDate("2026-07-06"))).toBe(1);
    expect(isoWeekday(asSalonDate("2026-07-10"))).toBe(5);
    expect(isoWeekday(asSalonDate("2026-07-11"))).toBe(6);
    expect(isoWeekday(asSalonDate("2026-07-12"))).toBe(7);
  });
});

describe("Europe/Rome clock projection", () => {
  it("crosses Rome midnight independently of UTC midnight", () => {
    expect(romeClock(new Date("2026-01-01T22:59:00Z"))).toEqual({
      date: "2026-01-01",
      minuteOfDay: 1439,
    });
    expect(romeClock(new Date("2026-01-01T23:00:00Z"))).toEqual({
      date: "2026-01-02",
      minuteOfDay: 0,
    });
    expect(romeDate(new Date("2026-07-05T22:30:00Z"))).toBe("2026-07-06");
  });

  it("projects the spring DST jump and rejects a nonexistent wall time", () => {
    expect(romeClock(new Date("2026-03-29T00:30:00Z"))).toEqual({
      date: "2026-03-29",
      minuteOfDay: 90,
    });
    expect(romeClock(new Date("2026-03-29T01:30:00Z"))).toEqual({
      date: "2026-03-29",
      minuteOfDay: 210,
    });

    expect(() =>
      romeLocalToInstant(asSalonDate("2026-03-29"), asMinuteOfDay(150)),
    ).toThrow(/does not exist/);
  });

  it("handles the repeated autumn hour deterministically", () => {
    const repeatedDate = asSalonDate("2026-10-25");
    expect(romeClock(new Date("2026-10-25T00:30:00Z"))).toEqual({
      date: repeatedDate,
      minuteOfDay: 150,
    });
    expect(romeClock(new Date("2026-10-25T01:30:00Z"))).toEqual({
      date: repeatedDate,
      minuteOfDay: 150,
    });

    expect(
      romeLocalToInstant(repeatedDate, asMinuteOfDay(150)).toISOString(),
    ).toBe("2026-10-25T00:30:00.000Z");
  });

  it("requires a valid injected instant", () => {
    expect(() => romeClock(new Date(Number.NaN))).toThrow(RangeError);
  });
});

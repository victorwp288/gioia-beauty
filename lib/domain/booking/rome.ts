import { asMinuteOfDay, asSalonDate } from "./primitives";
import type { MinuteOfDay, RomeClock, SalonDate } from "./types";

export const ROME_TIME_ZONE = "Europe/Rome";

const romeFormatter = new Intl.DateTimeFormat("en-GB-u-ca-gregory", {
  timeZone: ROME_TIME_ZONE,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  hourCycle: "h23",
});

function assertValidInstant(instant: Date): void {
  if (!(instant instanceof Date) || !Number.isFinite(instant.getTime())) {
    throw new RangeError("now must be a valid Date instant");
  }
}

function formattedNumbers(instant: Date): Record<string, number> {
  const values: Record<string, number> = {};
  for (const part of romeFormatter.formatToParts(instant)) {
    if (part.type !== "literal") {
      values[part.type] = Number(part.value);
    }
  }
  return values;
}

function utcWallTimestamp(
  year: number,
  monthIndex: number,
  day: number,
  hour: number,
  minute: number,
): number {
  const instant = new Date(0);
  instant.setUTCHours(hour, minute, 0, 0);
  instant.setUTCFullYear(year, monthIndex, day);
  return instant.getTime();
}

function offsetMinutesAt(timestamp: number): number {
  const minuteTimestamp = Math.floor(timestamp / 60_000) * 60_000;
  const parts = formattedNumbers(new Date(minuteTimestamp));
  const projectedAsUtc = utcWallTimestamp(
    parts.year!,
    parts.month! - 1,
    parts.day!,
    parts.hour!,
    parts.minute!,
  );
  return (projectedAsUtc - minuteTimestamp) / 60_000;
}

function sameRomeWallTime(
  timestamp: number,
  date: SalonDate,
  minuteOfDay: MinuteOfDay,
): boolean {
  const clock = romeClock(new Date(timestamp));
  return clock.date === date && clock.minuteOfDay === minuteOfDay;
}

export function romeClock(instant: Date): RomeClock {
  assertValidInstant(instant);
  const parts = formattedNumbers(instant);
  const date = asSalonDate(
    `${String(parts.year).padStart(4, "0")}-${String(parts.month).padStart(2, "0")}-${String(parts.day).padStart(2, "0")}`,
  );
  return {
    date,
    minuteOfDay: asMinuteOfDay(parts.hour! * 60 + parts.minute!),
  };
}

export function romeDate(instant: Date): SalonDate {
  return romeClock(instant).date;
}

export function romeLocalToInstant(
  date: SalonDate,
  minuteOfDay: MinuteOfDay,
): Date {
  const year = Number(date.slice(0, 4));
  const monthIndex = Number(date.slice(5, 7)) - 1;
  const day = Number(date.slice(8, 10));
  const hour = Math.floor(minuteOfDay / 60);
  const minute = minuteOfDay % 60;
  const wallTimeAsUtc = utcWallTimestamp(year, monthIndex, day, hour, minute);
  const sampleDistance = 36 * 60 * 60 * 1_000;
  const offsets = new Set([
    offsetMinutesAt(wallTimeAsUtc - sampleDistance),
    offsetMinutesAt(wallTimeAsUtc),
    offsetMinutesAt(wallTimeAsUtc + sampleDistance),
  ]);
  const candidates = [...offsets]
    .map((offset) => wallTimeAsUtc - offset * 60_000)
    .filter((timestamp) => sameRomeWallTime(timestamp, date, minuteOfDay))
    .sort((left, right) => left - right);

  if (candidates[0] === undefined) {
    throw new RangeError(`Rome local time ${date} does not exist`);
  }
  return new Date(candidates[0]);
}

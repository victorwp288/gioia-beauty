import type {
  BufferMinutes,
  DurationMinutes,
  IsoWeekday,
  MinuteBoundary,
  MinuteOfDay,
  SalonDate,
} from "./types";

const ISO_DATE_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/;
const MILLISECONDS_PER_DAY = 86_400_000;

function asIntegerInRange(
  value: unknown,
  name: string,
  minimum: number,
  maximum: number,
): number {
  if (typeof value !== "number" || !Number.isInteger(value)) {
    throw new TypeError(`${name} must be an integer`);
  }
  if (value < minimum || value > maximum) {
    throw new RangeError(`${name} must be between ${minimum} and ${maximum}`);
  }
  return value;
}

function utcTimestamp(date: SalonDate): number {
  const year = Number(date.slice(0, 4));
  const monthIndex = Number(date.slice(5, 7)) - 1;
  const day = Number(date.slice(8, 10));
  const instant = new Date(0);
  instant.setUTCHours(0, 0, 0, 0);
  instant.setUTCFullYear(year, monthIndex, day);
  return instant.getTime();
}

function formatUtcDate(timestamp: number): string {
  const instant = new Date(timestamp);
  const year = String(instant.getUTCFullYear()).padStart(4, "0");
  const month = String(instant.getUTCMonth() + 1).padStart(2, "0");
  const day = String(instant.getUTCDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

export function asSalonDate(value: unknown): SalonDate {
  if (typeof value !== "string") {
    throw new TypeError("salon date must be a string");
  }
  const match = ISO_DATE_PATTERN.exec(value);
  if (!match || match[1] === "0000") {
    throw new RangeError("salon date must use YYYY-MM-DD");
  }

  const candidate = value as SalonDate;
  if (formatUtcDate(utcTimestamp(candidate)) !== candidate) {
    throw new RangeError("salon date must be a real Gregorian calendar date");
  }
  return candidate;
}

export function asMinuteOfDay(value: unknown): MinuteOfDay {
  return asIntegerInRange(value, "minute of day", 0, 1439) as MinuteOfDay;
}

export function asMinuteBoundary(value: unknown): MinuteBoundary {
  return asIntegerInRange(value, "minute boundary", 0, 1440) as MinuteBoundary;
}

export function asDurationMinutes(value: unknown): DurationMinutes {
  return asIntegerInRange(value, "service duration", 1, 480) as DurationMinutes;
}

export function asBufferMinutes(value: unknown): BufferMinutes {
  return asIntegerInRange(value, "buffer", 0, 120) as BufferMinutes;
}

export function asSlotAlignmentMinutes(value: unknown): number {
  const alignment = asIntegerInRange(value, "slot alignment", 5, 60);
  if (60 % alignment !== 0) {
    throw new RangeError("slot alignment must divide evenly into one hour");
  }
  return alignment;
}

export function formatMinuteOfDay(value: MinuteOfDay): string {
  const hour = Math.floor(value / 60);
  const minute = value % 60;
  return `${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`;
}

export function addSalonDays(date: SalonDate, days: number): SalonDate {
  if (!Number.isInteger(days)) {
    throw new TypeError("calendar-day offset must be an integer");
  }
  return asSalonDate(
    formatUtcDate(utcTimestamp(date) + days * MILLISECONDS_PER_DAY),
  );
}

export function daysBetweenSalonDates(from: SalonDate, to: SalonDate): number {
  return (utcTimestamp(to) - utcTimestamp(from)) / MILLISECONDS_PER_DAY;
}

export function compareSalonDates(left: SalonDate, right: SalonDate): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

export function isoWeekday(date: SalonDate): IsoWeekday {
  const sundayBasedDay = new Date(utcTimestamp(date)).getUTCDay();
  return (sundayBasedDay === 0 ? 7 : sundayBasedDay) as IsoWeekday;
}

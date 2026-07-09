import { asMinuteBoundary } from "./primitives";
import type {
  BufferMinutes,
  DurationMinutes,
  MinuteOfDay,
  OccupiedInterval,
  SalonDate,
  ScheduleEntry,
  ScheduleEntryState,
  Vacation,
} from "./types";

function assertInterval(interval: OccupiedInterval): void {
  asMinuteBoundary(interval.start);
  asMinuteBoundary(interval.end);
  if (interval.start >= interval.end) {
    throw new RangeError("occupied interval must have positive length");
  }
}

function rejectUnknownScheduleState(value: never): never {
  void value;
  throw new RangeError("schedule entry kind or status is not recognized");
}

export function occupiedInterval(
  start: MinuteOfDay,
  serviceDurationMinutes: DurationMinutes,
  bufferMinutes: BufferMinutes,
): OccupiedInterval {
  const end = asMinuteBoundary(start + serviceDurationMinutes + bufferMinutes);
  const interval = {
    start: asMinuteBoundary(start),
    end,
  };
  assertInterval(interval);
  return interval;
}

export function intervalsOverlap(
  left: OccupiedInterval,
  right: OccupiedInterval,
): boolean {
  assertInterval(left);
  assertInterval(right);
  return left.start < right.end && right.start < left.end;
}

export function entryConsumesAvailability(entry: ScheduleEntryState): boolean {
  switch (entry.kind) {
    case "appointment": {
      const status = entry.status;
      switch (status) {
        case "confirmed":
        case "completed":
          return true;
        case "cancelled":
        case "no_show":
          return false;
        default:
          return rejectUnknownScheduleState(status);
      }
    }
    case "block": {
      const status = entry.status;
      switch (status) {
        case "active":
          return true;
        case "cancelled":
          return false;
        default:
          return rejectUnknownScheduleState(status);
      }
    }
    default:
      return rejectUnknownScheduleState(entry);
  }
}

export function entryConflictsWith(
  candidate: OccupiedInterval,
  date: SalonDate,
  entry: ScheduleEntry,
): boolean {
  if (entry.date !== date || !entryConsumesAvailability(entry)) {
    return false;
  }
  const existing = occupiedInterval(
    entry.startMinutes,
    entry.serviceDurationMinutes,
    entry.bufferMinutes,
  );
  return intervalsOverlap(candidate, existing);
}

export function isDateOnActiveVacation(
  date: SalonDate,
  vacations: readonly Vacation[],
): boolean {
  return vacations.some((vacation) => {
    if (vacation.startDate > vacation.endDate) {
      throw new RangeError("vacation start date must not follow its end date");
    }
    return (
      vacation.status === "active" &&
      vacation.startDate <= date &&
      date <= vacation.endDate
    );
  });
}

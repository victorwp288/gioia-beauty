import {
  asMinuteBoundary,
  asMinuteOfDay,
  asSlotAlignmentMinutes,
  isoWeekday,
} from "./primitives";
import { occupiedInterval } from "./intervals";
import type {
  BufferMinutes,
  BusinessHoursSchedule,
  BusinessHoursSegment,
  DurationMinutes,
  MinuteOfDay,
  OccupiedInterval,
  SalonDate,
} from "./types";

export const DEFAULT_BUSINESS_HOURS: BusinessHoursSchedule = {
  1: [{ start: asMinuteBoundary(540), end: asMinuteBoundary(1140) }],
  2: [{ start: asMinuteBoundary(600), end: asMinuteBoundary(1200) }],
  3: [{ start: asMinuteBoundary(540), end: asMinuteBoundary(1140) }],
  4: [{ start: asMinuteBoundary(600), end: asMinuteBoundary(1200) }],
  5: [{ start: asMinuteBoundary(540), end: asMinuteBoundary(1110) }],
  6: [],
  7: [],
};

function assertValidSegments(segments: readonly BusinessHoursSegment[]): void {
  let previousEnd = -1;
  for (const segment of segments) {
    asMinuteBoundary(segment.start);
    asMinuteBoundary(segment.end);
    if (segment.start >= segment.end) {
      throw new RangeError("business-hours segment must have positive length");
    }
    if (segment.start < previousEnd) {
      throw new RangeError("business-hours segments must not overlap");
    }
    previousEnd = segment.end;
  }
}

export function businessHoursForDate(
  date: SalonDate,
  schedule: BusinessHoursSchedule,
): readonly BusinessHoursSegment[] {
  if (schedule === null || typeof schedule !== "object") {
    throw new TypeError("business-hours schedule is required");
  }
  const segments = schedule[isoWeekday(date)];
  if (!Array.isArray(segments)) {
    throw new RangeError("business-hours schedule must define every weekday");
  }
  assertValidSegments(segments);
  return segments;
}

export function intervalFitsBusinessHours(
  interval: OccupiedInterval,
  segments: readonly BusinessHoursSegment[],
): boolean {
  assertValidSegments(segments);
  return segments.some(
    (segment) => segment.start <= interval.start && interval.end <= segment.end,
  );
}

interface GenerateBusinessStartsInput {
  readonly date: SalonDate;
  readonly serviceDurationMinutes: DurationMinutes;
  readonly bufferMinutes: BufferMinutes;
  readonly alignmentMinutes: number;
  readonly businessHours: BusinessHoursSchedule;
}

export function generateBusinessStarts({
  date,
  serviceDurationMinutes,
  bufferMinutes,
  alignmentMinutes,
  businessHours,
}: GenerateBusinessStartsInput): MinuteOfDay[] {
  const alignment = asSlotAlignmentMinutes(alignmentMinutes);
  const segments = businessHoursForDate(date, businessHours);
  const starts: MinuteOfDay[] = [];

  for (const segment of segments) {
    const firstStart = Math.ceil(segment.start / alignment) * alignment;
    for (let minute = firstStart; minute < segment.end; minute += alignment) {
      const start = asMinuteOfDay(minute);
      const candidate = occupiedInterval(
        start,
        serviceDurationMinutes,
        bufferMinutes,
      );
      if (candidate.end > segment.end) {
        break;
      }
      starts.push(start);
    }
  }
  return starts;
}

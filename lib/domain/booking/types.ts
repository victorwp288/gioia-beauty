declare const salonDateBrand: unique symbol;
declare const minuteOfDayBrand: unique symbol;
declare const minuteBoundaryBrand: unique symbol;
declare const durationMinutesBrand: unique symbol;
declare const bufferMinutesBrand: unique symbol;

export type SalonDate = string & { readonly [salonDateBrand]: true };
export type MinuteOfDay = number & { readonly [minuteOfDayBrand]: true };
export type MinuteBoundary = number & { readonly [minuteBoundaryBrand]: true };
export type DurationMinutes = number & {
  readonly [durationMinutesBrand]: true;
};
export type BufferMinutes = number & { readonly [bufferMinutesBrand]: true };
export type IsoWeekday = 1 | 2 | 3 | 4 | 5 | 6 | 7;

export interface OccupiedInterval {
  readonly start: MinuteBoundary;
  readonly end: MinuteBoundary;
}

export interface BusinessHoursSegment extends OccupiedInterval {}

export type BusinessHoursSchedule = Readonly<
  Record<IsoWeekday, readonly BusinessHoursSegment[]>
>;

interface ScheduleEntryBase {
  readonly id: string;
  readonly date: SalonDate;
  readonly startMinutes: MinuteOfDay;
  readonly serviceDurationMinutes: DurationMinutes;
  readonly bufferMinutes: BufferMinutes;
}

export interface AppointmentEntry extends ScheduleEntryBase {
  readonly kind: "appointment";
  readonly status: "confirmed" | "completed" | "cancelled" | "no_show";
}

export interface BlockEntry extends ScheduleEntryBase {
  readonly kind: "block";
  readonly status: "active" | "cancelled";
}

export type ScheduleEntry = AppointmentEntry | BlockEntry;
export type ScheduleEntryState =
  | Pick<AppointmentEntry, "kind" | "status">
  | Pick<BlockEntry, "kind" | "status">;

export interface Vacation {
  readonly status: "active" | "cancelled";
  readonly startDate: SalonDate;
  readonly endDate: SalonDate;
}

export interface BookingPolicy {
  readonly sameDayAllowed: boolean;
  readonly minimumLeadMinutes: number;
  readonly maximumAdvanceDays: number;
  readonly slotAlignmentMinutes: number;
}

export interface OwnerBookingPolicy {
  readonly slotAlignmentMinutes: number;
}

export type PublicBookingViolation =
  | "past_date"
  | "same_day_not_allowed"
  | "beyond_max_advance"
  | "misaligned_start"
  | "minimum_lead_time";

export type OwnerBookingViolation =
  "past_date" | "past_start" | "misaligned_start";

export interface RomeClock {
  readonly date: SalonDate;
  readonly minuteOfDay: MinuteOfDay;
}

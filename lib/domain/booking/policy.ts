import { asSlotAlignmentMinutes, daysBetweenSalonDates } from "./primitives";
import { romeDate, romeLocalToInstant } from "./rome";
import type {
  BookingPolicy,
  MinuteOfDay,
  OwnerBookingPolicy,
  OwnerBookingViolation,
  PublicBookingViolation,
  SalonDate,
} from "./types";

export const DEFAULT_BOOKING_POLICY: BookingPolicy = {
  sameDayAllowed: false,
  minimumLeadMinutes: 0,
  maximumAdvanceDays: 60,
  slotAlignmentMinutes: 15,
};

export const DEFAULT_OWNER_BOOKING_POLICY: OwnerBookingPolicy = {
  slotAlignmentMinutes: 15,
};

function assertPolicy(policy: BookingPolicy): void {
  if (policy === null || typeof policy !== "object") {
    throw new TypeError("public booking policy is required");
  }
  if (typeof policy.sameDayAllowed !== "boolean") {
    throw new TypeError("same-day policy must be boolean");
  }
  if (
    !Number.isInteger(policy.minimumLeadMinutes) ||
    policy.minimumLeadMinutes < 0
  ) {
    throw new RangeError("minimum lead time must be a nonnegative integer");
  }
  if (
    !Number.isInteger(policy.maximumAdvanceDays) ||
    policy.maximumAdvanceDays < 1 ||
    policy.maximumAdvanceDays > 365
  ) {
    throw new RangeError("maximum advance days must be between 1 and 365");
  }
  asSlotAlignmentMinutes(policy.slotAlignmentMinutes);
}

function assertOwnerPolicy(policy: OwnerBookingPolicy): void {
  if (policy === null || typeof policy !== "object") {
    throw new TypeError("owner booking policy is required");
  }
  asSlotAlignmentMinutes(policy.slotAlignmentMinutes);
}

interface PublicBookingPolicyInput {
  readonly date: SalonDate;
  readonly startMinutes: MinuteOfDay;
  readonly now: Date;
  readonly policy: BookingPolicy;
}

export function publicBookingViolation({
  date,
  startMinutes,
  now,
  policy,
}: PublicBookingPolicyInput): PublicBookingViolation | null {
  assertPolicy(policy);
  const today = romeDate(now);
  const calendarDistance = daysBetweenSalonDates(today, date);

  if (calendarDistance < 0) {
    return "past_date";
  }
  if (calendarDistance === 0 && !policy.sameDayAllowed) {
    return "same_day_not_allowed";
  }
  if (calendarDistance > policy.maximumAdvanceDays) {
    return "beyond_max_advance";
  }
  if (startMinutes % policy.slotAlignmentMinutes !== 0) {
    return "misaligned_start";
  }

  const bookingInstant = romeLocalToInstant(date, startMinutes);
  const leadMilliseconds = policy.minimumLeadMinutes * 60_000;
  if (bookingInstant.getTime() - now.getTime() < leadMilliseconds) {
    return "minimum_lead_time";
  }
  return null;
}

interface OwnerBookingPolicyInput {
  readonly date: SalonDate;
  readonly startMinutes: MinuteOfDay;
  readonly now: Date;
  readonly policy: OwnerBookingPolicy;
}

export function ownerBookingViolation({
  date,
  startMinutes,
  now,
  policy,
}: OwnerBookingPolicyInput): OwnerBookingViolation | null {
  assertOwnerPolicy(policy);
  const today = romeDate(now);
  const calendarDistance = daysBetweenSalonDates(today, date);

  if (calendarDistance < 0) {
    return "past_date";
  }
  if (startMinutes % policy.slotAlignmentMinutes !== 0) {
    return "misaligned_start";
  }

  const bookingInstant = romeLocalToInstant(date, startMinutes);
  if (bookingInstant.getTime() < now.getTime()) {
    return "past_start";
  }
  return null;
}

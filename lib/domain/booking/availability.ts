import {
  businessHoursForDate,
  generateBusinessStarts,
  intervalFitsBusinessHours,
} from "./hours";
import {
  entryConflictsWith,
  isDateOnActiveVacation,
  occupiedInterval,
} from "./intervals";
import type {
  ActiveBookingVariant,
  ValidatedBlockOccupancy,
} from "./occupancy";
import { ownerBookingViolation, publicBookingViolation } from "./policy";
import type {
  BookingPolicy,
  BufferMinutes,
  BusinessHoursSchedule,
  DurationMinutes,
  MinuteOfDay,
  OwnerBookingPolicy,
  SalonDate,
  ScheduleEntry,
  Vacation,
} from "./types";

interface AvailabilityContext {
  readonly date: SalonDate;
  readonly entries: readonly ScheduleEntry[];
  readonly vacations: readonly Vacation[];
  readonly now: Date;
  readonly businessHours: BusinessHoursSchedule;
  readonly excludeEntryId?: string;
}

interface Occupancy {
  readonly durationMinutes: DurationMinutes;
  readonly bufferMinutes: BufferMinutes;
}

interface StartAvailabilityContext extends AvailabilityContext {
  readonly startMinutes: MinuteOfDay;
}

export interface PublicAppointmentAvailabilityInput extends Omit<
  AvailabilityContext,
  "excludeEntryId"
> {
  readonly variant: ActiveBookingVariant;
  readonly policy: BookingPolicy;
}

export interface PublicAppointmentStartAvailabilityInput extends PublicAppointmentAvailabilityInput {
  readonly startMinutes: MinuteOfDay;
}

export interface OwnerAppointmentAvailabilityInput extends AvailabilityContext {
  readonly variant: ActiveBookingVariant;
  readonly policy: OwnerBookingPolicy;
}

export interface OwnerAppointmentStartAvailabilityInput extends OwnerAppointmentAvailabilityInput {
  readonly startMinutes: MinuteOfDay;
}

export interface OwnerBlockAvailabilityInput extends AvailabilityContext {
  readonly block: ValidatedBlockOccupancy;
  readonly policy: OwnerBookingPolicy;
}

export interface OwnerBlockStartAvailabilityInput extends OwnerBlockAvailabilityInput {
  readonly startMinutes: MinuteOfDay;
}

type StartPolicyCheck = (startMinutes: MinuteOfDay) => boolean;

function variantOccupancy(variant: ActiveBookingVariant): Occupancy {
  return {
    durationMinutes: variant.serviceDurationMinutes,
    bufferMinutes: variant.bufferMinutes,
  };
}

function blockOccupancy(block: ValidatedBlockOccupancy): Occupancy {
  return {
    durationMinutes: block.durationMinutes,
    bufferMinutes: block.bufferMinutes,
  };
}

function isOccupancyStartAvailable(
  input: StartAvailabilityContext,
  occupancy: Occupancy,
  policyAllowsStart: StartPolicyCheck,
): boolean {
  if (isDateOnActiveVacation(input.date, input.vacations)) {
    return false;
  }

  const candidate = occupiedInterval(
    input.startMinutes,
    occupancy.durationMinutes,
    occupancy.bufferMinutes,
  );
  if (
    !intervalFitsBusinessHours(
      candidate,
      businessHoursForDate(input.date, input.businessHours),
    )
  ) {
    return false;
  }
  if (!policyAllowsStart(input.startMinutes)) {
    return false;
  }

  return !input.entries.some(
    (entry) =>
      entry.id !== input.excludeEntryId &&
      entryConflictsWith(candidate, input.date, entry),
  );
}

function availableOccupancyStartMinutes(
  input: AvailabilityContext,
  occupancy: Occupancy,
  alignmentMinutes: number,
  policyAllowsStart: StartPolicyCheck,
): MinuteOfDay[] {
  if (isDateOnActiveVacation(input.date, input.vacations)) {
    return [];
  }
  const starts = generateBusinessStarts({
    date: input.date,
    serviceDurationMinutes: occupancy.durationMinutes,
    bufferMinutes: occupancy.bufferMinutes,
    alignmentMinutes,
    businessHours: input.businessHours,
  });
  return starts.filter((startMinutes) =>
    isOccupancyStartAvailable(
      { ...input, startMinutes },
      occupancy,
      policyAllowsStart,
    ),
  );
}

function publicPolicyCheck(
  input: PublicAppointmentAvailabilityInput,
): StartPolicyCheck {
  return (startMinutes) =>
    publicBookingViolation({
      date: input.date,
      startMinutes,
      now: input.now,
      policy: input.policy,
    }) === null;
}

function ownerPolicyCheck(
  input: OwnerAppointmentAvailabilityInput | OwnerBlockAvailabilityInput,
): StartPolicyCheck {
  return (startMinutes) =>
    ownerBookingViolation({
      date: input.date,
      startMinutes,
      now: input.now,
      policy: input.policy,
    }) === null;
}

export function isPublicAppointmentStartAvailable(
  input: PublicAppointmentStartAvailabilityInput,
): boolean {
  return isOccupancyStartAvailable(
    input,
    variantOccupancy(input.variant),
    publicPolicyCheck(input),
  );
}

export function availablePublicAppointmentStartMinutes(
  input: PublicAppointmentAvailabilityInput,
): MinuteOfDay[] {
  return availableOccupancyStartMinutes(
    input,
    variantOccupancy(input.variant),
    input.policy.slotAlignmentMinutes,
    publicPolicyCheck(input),
  );
}

export function isOwnerAppointmentStartAvailable(
  input: OwnerAppointmentStartAvailabilityInput,
): boolean {
  return isOccupancyStartAvailable(
    input,
    variantOccupancy(input.variant),
    ownerPolicyCheck(input),
  );
}

export function availableOwnerAppointmentStartMinutes(
  input: OwnerAppointmentAvailabilityInput,
): MinuteOfDay[] {
  return availableOccupancyStartMinutes(
    input,
    variantOccupancy(input.variant),
    input.policy.slotAlignmentMinutes,
    ownerPolicyCheck(input),
  );
}

export function isOwnerBlockStartAvailable(
  input: OwnerBlockStartAvailabilityInput,
): boolean {
  return isOccupancyStartAvailable(
    input,
    blockOccupancy(input.block),
    ownerPolicyCheck(input),
  );
}

export function availableOwnerBlockStartMinutes(
  input: OwnerBlockAvailabilityInput,
): MinuteOfDay[] {
  return availableOccupancyStartMinutes(
    input,
    blockOccupancy(input.block),
    input.policy.slotAlignmentMinutes,
    ownerPolicyCheck(input),
  );
}

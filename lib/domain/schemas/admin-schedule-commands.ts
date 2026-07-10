import { z } from "zod";

import { daysBetweenSalonDates } from "../booking/primitives.ts";
import {
  BufferMinutesSchema,
  CancellationReasonSchema,
  CatalogServiceIdSchema,
  CatalogVariantIdSchema,
  DurationMinutesSchema,
  IdempotencyKeySchema,
  InternalNoteSchema,
  NormalizedEmailSchema,
  NormalizedPhoneSchema,
  PersonNameSchema,
  PositiveVersionSchema,
  PublicNoteSchema,
  SalonDateSchema,
  StartMinutesSchema,
  UuidSchema,
  VacationReasonSchema,
  optionalNullableTrimmedText,
} from "./primitives.ts";

const commandFields = { idempotencyKey: IdempotencyKeySchema };
const slotFields = {
  date: SalonDateSchema,
  startMinutes: StartMinutesSchema,
};
const catalogFields = {
  serviceId: CatalogServiceIdSchema,
  variantId: CatalogVariantIdSchema,
};
const versionedEntryFields = {
  entryId: UuidSchema,
  expectedVersion: PositiveVersionSchema,
};
const optionalContactFields = {
  clientName: PersonNameSchema,
  clientEmail: NormalizedEmailSchema.nullable(),
  clientPhone: NormalizedPhoneSchema.nullable(),
  clientNote: PublicNoteSchema,
};
const patchContactFields = {
  clientName: PersonNameSchema.optional(),
  clientEmail: NormalizedEmailSchema.nullable().optional(),
  clientPhone: NormalizedPhoneSchema.nullable().optional(),
  clientNote: optionalNullableTrimmedText(2000),
  internalNote: optionalNullableTrimmedText(2000),
};

function requirePatchField(
  command: Record<string, unknown>,
  fields: string[],
  context: z.RefinementCtx,
) {
  if (!fields.some((field) => command[field] !== undefined)) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      message: "At least one editable field is required",
      path: fields,
    });
  }
}

function validateAppointmentPatch(
  command: Record<string, unknown>,
  context: z.RefinementCtx,
) {
  requirePatchField(
    command,
    ["clientName", "clientEmail", "clientPhone", "clientNote", "internalNote"],
    context,
  );
}

function validateBlockPatch(
  command: Record<string, unknown>,
  context: z.RefinementCtx,
) {
  requirePatchField(command, ["internalNote"], context);
}

function validateBlockWithinSalonDay(
  command: {
    startMinutes: number;
    durationMinutes: number;
    bufferMinutes: number;
  },
  context: z.RefinementCtx,
) {
  if (
    command.startMinutes + command.durationMinutes + command.bufferMinutes >
    1440
  ) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      message: "Block must end within the salon-local day",
      path: ["startMinutes"],
    });
  }
}

function validateVacationDateRange(
  command: {
    startDate: z.infer<typeof SalonDateSchema>;
    endDate: z.infer<typeof SalonDateSchema>;
  },
  context: z.RefinementCtx,
) {
  const days = daysBetweenSalonDates(command.startDate, command.endDate);
  if (days < 0 || days > 365) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      message: "Vacation must span between 1 and 366 inclusive dates",
      path: ["endDate"],
    });
  }
}

const adminCreateAppointmentFields = {
  ...slotFields,
  ...catalogFields,
  ...optionalContactFields,
};
export const AdminCreateAppointmentBodySchema = z
  .object(adminCreateAppointmentFields)
  .strict();
export const AdminCreateAppointmentCommandSchema = z
  .object({ ...commandFields, ...adminCreateAppointmentFields })
  .strict();

const adminUpdateAppointmentFields = {
  ...versionedEntryFields,
  ...patchContactFields,
};
export const AdminUpdateAppointmentBodySchema = z
  .object(adminUpdateAppointmentFields)
  .strict()
  .superRefine(validateAppointmentPatch);
export const AdminUpdateAppointmentCommandSchema = z
  .object({ ...commandFields, ...adminUpdateAppointmentFields })
  .strict()
  .superRefine(validateAppointmentPatch);

const adminCreateBlockFields = {
  ...slotFields,
  durationMinutes: DurationMinutesSchema,
  bufferMinutes: BufferMinutesSchema.default(0),
  internalNote: InternalNoteSchema,
};
export const AdminCreateBlockBodySchema = z
  .object(adminCreateBlockFields)
  .strict()
  .superRefine(validateBlockWithinSalonDay);
export const AdminCreateBlockCommandSchema = z
  .object({ ...commandFields, ...adminCreateBlockFields })
  .strict()
  .superRefine(validateBlockWithinSalonDay);

const adminUpdateBlockFields = {
  ...versionedEntryFields,
  internalNote: optionalNullableTrimmedText(2000),
};
export const AdminUpdateBlockBodySchema = z
  .object(adminUpdateBlockFields)
  .strict()
  .superRefine(validateBlockPatch);
export const AdminUpdateBlockCommandSchema = z
  .object({ ...commandFields, ...adminUpdateBlockFields })
  .strict()
  .superRefine(validateBlockPatch);

const adminRescheduleAppointmentFields = {
  ...slotFields,
  ...versionedEntryFields,
  ...catalogFields,
};
export const AdminRescheduleAppointmentBodySchema = z
  .object(adminRescheduleAppointmentFields)
  .strict();
export const AdminRescheduleAppointmentCommandSchema = z
  .object({ ...commandFields, ...adminRescheduleAppointmentFields })
  .strict();

const adminRescheduleBlockFields = {
  ...slotFields,
  ...versionedEntryFields,
  durationMinutes: DurationMinutesSchema,
  bufferMinutes: BufferMinutesSchema.default(0),
};
export const AdminRescheduleBlockBodySchema = z
  .object(adminRescheduleBlockFields)
  .strict()
  .superRefine(validateBlockWithinSalonDay);
export const AdminRescheduleBlockCommandSchema = z
  .object({ ...commandFields, ...adminRescheduleBlockFields })
  .strict()
  .superRefine(validateBlockWithinSalonDay);

const adminCancelScheduleEntryFields = {
  ...versionedEntryFields,
  reason: CancellationReasonSchema,
};
export const AdminCancelScheduleEntryBodySchema = z
  .object(adminCancelScheduleEntryFields)
  .strict();
export const AdminCancelScheduleEntryCommandSchema = z
  .object({ ...commandFields, ...adminCancelScheduleEntryFields })
  .strict();

const adminSetAppointmentStatusFields = {
  ...versionedEntryFields,
  status: z.enum(["completed", "no_show"]),
};
export const AdminSetAppointmentStatusBodySchema = z
  .object(adminSetAppointmentStatusFields)
  .strict();
export const AdminSetAppointmentStatusCommandSchema = z
  .object({ ...commandFields, ...adminSetAppointmentStatusFields })
  .strict();

const adminCreateVacationFields = {
  startDate: SalonDateSchema,
  endDate: SalonDateSchema,
  reason: VacationReasonSchema,
};
export const AdminCreateVacationBodySchema = z
  .object(adminCreateVacationFields)
  .strict()
  .superRefine(validateVacationDateRange);
export const AdminCreateVacationCommandSchema = z
  .object({ ...commandFields, ...adminCreateVacationFields })
  .strict()
  .superRefine(validateVacationDateRange);

const adminCancelVacationFields = {
  vacationId: UuidSchema,
  expectedVersion: PositiveVersionSchema,
};
export const AdminCancelVacationBodySchema = z
  .object(adminCancelVacationFields)
  .strict();
export const AdminCancelVacationCommandSchema = z
  .object({ ...commandFields, ...adminCancelVacationFields })
  .strict();

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
  SignedActionTokenSchema,
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
const requiredContactFields = {
  clientName: PersonNameSchema,
  clientEmail: NormalizedEmailSchema,
  clientPhone: NormalizedPhoneSchema,
  clientNote: PublicNoteSchema,
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

export const PublicBookingCommandSchema = z
  .object({
    ...commandFields,
    ...slotFields,
    ...catalogFields,
    ...requiredContactFields,
  })
  .strict();

export const AdminCreateAppointmentCommandSchema = z
  .object({
    ...commandFields,
    ...slotFields,
    ...catalogFields,
    ...optionalContactFields,
  })
  .strict();

export const AdminUpdateAppointmentCommandSchema = z
  .object({
    ...commandFields,
    entryId: UuidSchema,
    expectedVersion: PositiveVersionSchema,
    ...patchContactFields,
  })
  .strict()
  .superRefine((command, context) =>
    requirePatchField(
      command,
      [
        "clientName",
        "clientEmail",
        "clientPhone",
        "clientNote",
        "internalNote",
      ],
      context,
    ),
  );

export const AdminCreateBlockCommandSchema = z
  .object({
    ...commandFields,
    ...slotFields,
    durationMinutes: DurationMinutesSchema,
    bufferMinutes: BufferMinutesSchema.default(0),
    internalNote: InternalNoteSchema,
  })
  .strict()
  .superRefine((command, context) => {
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
  });

export const AdminUpdateBlockCommandSchema = z
  .object({
    ...commandFields,
    entryId: UuidSchema,
    expectedVersion: PositiveVersionSchema,
    internalNote: optionalNullableTrimmedText(2000),
  })
  .strict()
  .superRefine((command, context) =>
    requirePatchField(command, ["internalNote"], context),
  );

export const AdminRescheduleAppointmentCommandSchema = z
  .object({
    ...commandFields,
    ...slotFields,
    entryId: UuidSchema,
    expectedVersion: PositiveVersionSchema,
    ...catalogFields,
  })
  .strict();

export const AdminRescheduleBlockCommandSchema = z
  .object({
    ...commandFields,
    ...slotFields,
    entryId: UuidSchema,
    expectedVersion: PositiveVersionSchema,
    durationMinutes: DurationMinutesSchema,
    bufferMinutes: BufferMinutesSchema.default(0),
  })
  .strict()
  .superRefine((command, context) => {
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
  });

export const AdminCancelScheduleEntryCommandSchema = z
  .object({
    ...commandFields,
    entryId: UuidSchema,
    expectedVersion: PositiveVersionSchema,
    reason: CancellationReasonSchema,
  })
  .strict();

export const AdminSetAppointmentStatusCommandSchema = z
  .object({
    ...commandFields,
    entryId: UuidSchema,
    expectedVersion: PositiveVersionSchema,
    status: z.enum(["completed", "no_show"]),
  })
  .strict();

export const AdminCreateVacationCommandSchema = z
  .object({
    ...commandFields,
    startDate: SalonDateSchema,
    endDate: SalonDateSchema,
    reason: VacationReasonSchema,
  })
  .strict()
  .superRefine((command, context) => {
    const days = daysBetweenSalonDates(command.startDate, command.endDate);
    if (days < 0 || days > 365) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Vacation must span between 1 and 366 inclusive dates",
        path: ["endDate"],
      });
    }
  });

export const AdminCancelVacationCommandSchema = z
  .object({
    ...commandFields,
    vacationId: UuidSchema,
    expectedVersion: PositiveVersionSchema,
  })
  .strict();

export const PublicCancelAppointmentCommandSchema = z
  .object({
    ...commandFields,
    token: SignedActionTokenSchema,
  })
  .strict();

export const AdminRetryOutboxCommandSchema = z
  .object({
    ...commandFields,
    outboxId: UuidSchema,
    expectedVersion: PositiveVersionSchema,
  })
  .strict();

export type PublicBookingCommand = z.infer<typeof PublicBookingCommandSchema>;
export type AdminCreateAppointmentCommand = z.infer<
  typeof AdminCreateAppointmentCommandSchema
>;
export type AdminCreateBlockCommand = z.infer<
  typeof AdminCreateBlockCommandSchema
>;
export type AdminUpdateAppointmentCommand = z.infer<
  typeof AdminUpdateAppointmentCommandSchema
>;
export type AdminUpdateBlockCommand = z.infer<
  typeof AdminUpdateBlockCommandSchema
>;
export type AdminRescheduleAppointmentCommand = z.infer<
  typeof AdminRescheduleAppointmentCommandSchema
>;
export type AdminRescheduleBlockCommand = z.infer<
  typeof AdminRescheduleBlockCommandSchema
>;
export type AdminCancelScheduleEntryCommand = z.infer<
  typeof AdminCancelScheduleEntryCommandSchema
>;
export type AdminSetAppointmentStatusCommand = z.infer<
  typeof AdminSetAppointmentStatusCommandSchema
>;
export type AdminCreateVacationCommand = z.infer<
  typeof AdminCreateVacationCommandSchema
>;
export type AdminCancelVacationCommand = z.infer<
  typeof AdminCancelVacationCommandSchema
>;
export type PublicCancelAppointmentCommand = z.infer<
  typeof PublicCancelAppointmentCommandSchema
>;
export type AdminRetryOutboxCommand = z.infer<
  typeof AdminRetryOutboxCommandSchema
>;

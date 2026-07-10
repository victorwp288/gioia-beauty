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

const adminCreateAppointmentFields = {
  ...slotFields,
  ...catalogFields,
  ...optionalContactFields,
};
export const AdminCreateAppointmentBodySchema = z
  .object(adminCreateAppointmentFields)
  .strict();
export const AdminCreateAppointmentCommandSchema = z
  .object({
    ...commandFields,
    ...adminCreateAppointmentFields,
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

const adminCreateBlockFields = {
  ...slotFields,
  durationMinutes: DurationMinutesSchema,
  bufferMinutes: BufferMinutesSchema.default(0),
  internalNote: InternalNoteSchema,
};
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
export const AdminCreateBlockBodySchema = z
  .object(adminCreateBlockFields)
  .strict()
  .superRefine(validateBlockWithinSalonDay);
export const AdminCreateBlockCommandSchema = z
  .object({
    ...commandFields,
    ...adminCreateBlockFields,
  })
  .strict()
  .superRefine(validateBlockWithinSalonDay);

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

const adminCancelScheduleEntryFields = {
  entryId: UuidSchema,
  expectedVersion: PositiveVersionSchema,
  reason: CancellationReasonSchema,
};
export const AdminCancelScheduleEntryBodySchema = z
  .object(adminCancelScheduleEntryFields)
  .strict();
export const AdminCancelScheduleEntryCommandSchema = z
  .object({
    ...commandFields,
    ...adminCancelScheduleEntryFields,
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

const adminCreateVacationFields = {
  startDate: SalonDateSchema,
  endDate: SalonDateSchema,
  reason: VacationReasonSchema,
};
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
export const AdminCreateVacationBodySchema = z
  .object(adminCreateVacationFields)
  .strict()
  .superRefine(validateVacationDateRange);
export const AdminCreateVacationCommandSchema = z
  .object({
    ...commandFields,
    ...adminCreateVacationFields,
  })
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
  .object({
    ...commandFields,
    ...adminCancelVacationFields,
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

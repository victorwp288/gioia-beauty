import { z } from "zod";

import {
  SchemaVersionSchema,
  validateInstantNotBefore,
  validateTimestampOrder,
} from "./persistence.ts";
import {
  BufferMinutesSchema,
  CancellationReasonSchema,
  CatalogServiceIdSchema,
  CatalogVariantIdSchema,
  DurationMinutesSchema,
  InternalNoteSchema,
  IsoInstantSchema,
  NonnegativePostgresIntegerSchema,
  NormalizedEmailSchema,
  NormalizedPhoneSchema,
  PersonNameSchema,
  PositiveVersionSchema,
  PublicNoteSchema,
  SalonDateSchema,
  StartMinutesSchema,
  UuidSchema,
} from "./primitives.ts";
import {
  AppointmentStatusSchema,
  BlockStatusSchema,
  ScheduleCancellationActorSchema,
  ScheduleSourceSchema,
} from "./schedule.ts";

const dtoFields = {
  id: UuidSchema,
  schemaVersion: SchemaVersionSchema,
  source: ScheduleSourceSchema,
  date: SalonDateSchema,
  startMinutes: StartMinutesSchema,
  serviceDurationMinutes: DurationMinutesSchema,
  bufferMinutes: BufferMinutesSchema,
  cancelledAt: IsoInstantSchema.nullable(),
  cancelledBy: ScheduleCancellationActorSchema.nullable(),
  cancellationReason: CancellationReasonSchema,
  version: PositiveVersionSchema,
  createdAt: IsoInstantSchema,
  updatedAt: IsoInstantSchema,
};

const AdminAppointmentDtoObjectSchema = z
  .object({
    ...dtoFields,
    kind: z.literal("appointment"),
    status: AppointmentStatusSchema,
    serviceId: CatalogServiceIdSchema,
    variantId: CatalogVariantIdSchema,
    serviceNameSnapshot: z.string().trim().min(1).max(160),
    variantNameSnapshot: z.string().trim().min(1).max(160),
    priceCentsSnapshot: NonnegativePostgresIntegerSchema.nullable(),
    currencySnapshot: z.literal("EUR").nullable(),
    clientName: PersonNameSchema,
    clientEmail: NormalizedEmailSchema.nullable(),
    clientPhone: NormalizedPhoneSchema.nullable(),
    clientNote: PublicNoteSchema,
    internalNote: InternalNoteSchema,
  })
  .strict();

const AdminBlockDtoObjectSchema = z
  .object({
    ...dtoFields,
    kind: z.literal("block"),
    status: BlockStatusSchema,
    internalNote: InternalNoteSchema,
  })
  .strict();

type ScheduleDto =
  | z.infer<typeof AdminAppointmentDtoObjectSchema>
  | z.infer<typeof AdminBlockDtoObjectSchema>;

function validateScheduleDto(entry: ScheduleDto, context: z.RefinementCtx) {
  validateTimestampOrder(entry, context);
  validateInstantNotBefore(
    entry.cancelledAt,
    entry.createdAt,
    "cancelledAt",
    context,
  );
  const isCancelled = entry.status === "cancelled";
  const hasCancellationIdentity =
    entry.cancelledAt !== null && entry.cancelledBy !== null;

  if (isCancelled !== hasCancellationIdentity) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      message: "Cancellation metadata must match cancellation status",
      path: ["status"],
    });
  }
  if (!isCancelled && entry.cancellationReason !== null) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      message: "Cancellation reason is only valid for cancelled entries",
      path: ["cancellationReason"],
    });
  }
  if (
    entry.startMinutes + entry.serviceDurationMinutes + entry.bufferMinutes >
    1440
  ) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      message: "Occupied interval must end within the salon-local day",
      path: ["startMinutes"],
    });
  }
  if (
    entry.kind === "appointment" &&
    (entry.priceCentsSnapshot === null) !== (entry.currencySnapshot === null)
  ) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      message: "Price and currency snapshots must be paired",
      path: ["priceCentsSnapshot"],
    });
  }
}

export const AdminAppointmentDtoSchema =
  AdminAppointmentDtoObjectSchema.superRefine(validateScheduleDto);
export const AdminBlockDtoSchema =
  AdminBlockDtoObjectSchema.superRefine(validateScheduleDto);
export const AdminScheduleEntryDtoSchema = z
  .discriminatedUnion("kind", [
    AdminAppointmentDtoObjectSchema,
    AdminBlockDtoObjectSchema,
  ])
  .superRefine(validateScheduleDto);

export type AdminAppointmentDto = z.infer<typeof AdminAppointmentDtoSchema>;
export type AdminBlockDto = z.infer<typeof AdminBlockDtoSchema>;
export type AdminScheduleEntryDto = z.infer<typeof AdminScheduleEntryDtoSchema>;

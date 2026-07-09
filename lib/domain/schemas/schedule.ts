import { z } from "zod";

import {
  persistenceIdentityFields,
  validateImportProvenance,
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

export const AppointmentStatusSchema = z.enum([
  "confirmed",
  "completed",
  "cancelled",
  "no_show",
]);
export const BlockStatusSchema = z.enum(["active", "cancelled"]);
export const ScheduleSourceSchema = z.enum(["public", "admin", "migration"]);
export const ScheduleCancellationActorSchema = z.enum([
  "client",
  "admin",
  "system",
  "migration",
]);

const commonPersistenceFields = {
  ...persistenceIdentityFields,
  source: ScheduleSourceSchema,
  date: SalonDateSchema,
  startMinutes: StartMinutesSchema,
  serviceDurationMinutes: DurationMinutesSchema,
  bufferMinutes: BufferMinutesSchema,
  createdBy: UuidSchema.nullable(),
  version: PositiveVersionSchema,
};

const cancellationFields = {
  cancelledAt: IsoInstantSchema.nullable(),
  cancelledBy: ScheduleCancellationActorSchema.nullable(),
  cancellationReason: CancellationReasonSchema,
};

const AppointmentPersistenceObjectSchema = z
  .object({
    ...commonPersistenceFields,
    ...cancellationFields,
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

const BlockPersistenceObjectSchema = z
  .object({
    ...commonPersistenceFields,
    ...cancellationFields,
    kind: z.literal("block"),
    status: BlockStatusSchema,
    internalNote: InternalNoteSchema,
  })
  .strict();

type ScheduleEntryCandidate =
  | z.infer<typeof AppointmentPersistenceObjectSchema>
  | z.infer<typeof BlockPersistenceObjectSchema>;

function validateCancellation(
  entry: ScheduleEntryCandidate,
  context: z.RefinementCtx,
) {
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
  validateInstantNotBefore(
    entry.cancelledAt,
    entry.createdAt,
    "cancelledAt",
    context,
  );
}

function validateSource(
  entry: ScheduleEntryCandidate,
  context: z.RefinementCtx,
) {
  validateImportProvenance(entry, context);

  if (entry.source === "admin" && entry.createdBy === null) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      message: "Admin schedule entries require an owner identity",
      path: ["createdBy"],
    });
  }
  if (
    entry.source === "public" &&
    (entry.kind !== "appointment" ||
      entry.createdBy !== null ||
      entry.internalNote !== null)
  ) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      message: "Public schedule entries must have the public appointment shape",
      path: ["source"],
    });
  }
  if (
    entry.source === "public" &&
    entry.kind === "appointment" &&
    (entry.clientEmail === null || entry.clientPhone === null)
  ) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      message: "Public appointments require normalized contact details",
      path: ["clientEmail"],
    });
  }
}

function validateScheduleEntry(
  entry: ScheduleEntryCandidate,
  context: z.RefinementCtx,
) {
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
  validateTimestampOrder(entry, context);
  validateCancellation(entry, context);
  validateSource(entry, context);

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

export const AppointmentPersistenceSchema =
  AppointmentPersistenceObjectSchema.superRefine(validateScheduleEntry);
export const BlockPersistenceSchema = BlockPersistenceObjectSchema.superRefine(
  validateScheduleEntry,
);
export const ScheduleEntryPersistenceSchema = z
  .discriminatedUnion("kind", [
    AppointmentPersistenceObjectSchema,
    BlockPersistenceObjectSchema,
  ])
  .superRefine(validateScheduleEntry);

export type AppointmentPersistence = z.infer<
  typeof AppointmentPersistenceSchema
>;
export type BlockPersistence = z.infer<typeof BlockPersistenceSchema>;
export type ScheduleEntryPersistence = z.infer<
  typeof ScheduleEntryPersistenceSchema
>;

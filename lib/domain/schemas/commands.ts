import { z } from "zod";

import {
  CatalogServiceIdSchema,
  CatalogVariantIdSchema,
  IdempotencyKeySchema,
  NormalizedEmailSchema,
  NormalizedPhoneSchema,
  PersonNameSchema,
  PositiveVersionSchema,
  PublicNoteSchema,
  SalonDateSchema,
  SignedActionTokenSchema,
  StartMinutesSchema,
  UuidSchema,
} from "./primitives.ts";

export * from "./admin-schedule-commands.ts";

const commandFields = { idempotencyKey: IdempotencyKeySchema };

export const PublicBookingCommandSchema = z
  .object({
    ...commandFields,
    date: SalonDateSchema,
    startMinutes: StartMinutesSchema,
    serviceId: CatalogServiceIdSchema,
    variantId: CatalogVariantIdSchema,
    clientName: PersonNameSchema,
    clientEmail: NormalizedEmailSchema,
    clientPhone: NormalizedPhoneSchema,
    clientNote: PublicNoteSchema,
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

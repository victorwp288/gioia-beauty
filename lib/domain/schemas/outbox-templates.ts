import { z } from "zod";

import {
  DurationMinutesSchema,
  IsoInstantSchema,
  PersonNameSchema,
  PositiveVersionSchema,
  SalonDateSchema,
  StartMinutesSchema,
  UuidSchema,
} from "./primitives.ts";
import { ConsentPolicyVersionSchema } from "./subscribers.ts";
import { isNewsletterActionTokenKeyId } from "./subscriber-tokens.ts";

export const OutboxRecipientKindSchema = z.enum([
  "customer",
  "owner",
  "subscriber",
]);
export const OutboxTemplateKindSchema = z.enum([
  "booking_customer",
  "booking_owner",
  "cancellation_customer",
  "cancellation_owner",
  "reschedule_customer",
  "reschedule_owner",
  "newsletter_confirmation",
]);

const scheduleTemplateFields = {
  clientName: PersonNameSchema,
  localDate: SalonDateSchema,
  startMinutes: StartMinutesSchema,
  serviceDurationMinutes: DurationMinutesSchema,
  serviceName: z.string().trim().min(1).max(160),
  variantName: z.string().trim().min(1).max(160),
};

export const ScheduleOutboxTemplateDataSchema = z
  .object(scheduleTemplateFields)
  .strict();

export const RescheduleOutboxTemplateDataSchema = z
  .object({
    ...scheduleTemplateFields,
    oldLocalDate: SalonDateSchema,
    oldStartMinutes: StartMinutesSchema,
  })
  .strict();

export const NewsletterConfirmationTemplateDataSchema = z
  .object({
    policyVersion: ConsentPolicyVersionSchema,
    consentArtifactVersion: z.string().regex(/^[a-z0-9][a-z0-9._-]{2,99}$/),
    consentArtifactSha256: z.string().regex(/^[0-9a-f]{64}$/),
    action: z
      .object({
        version: z.literal(1),
        purpose: z.literal("newsletter_confirm"),
        tokenId: UuidSchema,
        issuedAt: IsoInstantSchema,
        expiresAt: IsoInstantSchema,
        signingKeyId: z.string().refine(isNewsletterActionTokenKeyId),
      })
      .strict(),
  })
  .strict();

export type ScheduleOutboxTemplateData = z.infer<
  typeof ScheduleOutboxTemplateDataSchema
>;
export type RescheduleOutboxTemplateData = z.infer<
  typeof RescheduleOutboxTemplateDataSchema
>;
export type NewsletterConfirmationTemplateData = z.infer<
  typeof NewsletterConfirmationTemplateDataSchema
>;

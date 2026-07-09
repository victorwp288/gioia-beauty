import { z } from "zod";

import {
  DurationMinutesSchema,
  PersonNameSchema,
  SalonDateSchema,
  StartMinutesSchema,
} from "./primitives.ts";
import { ConsentPolicyVersionSchema } from "./subscribers.ts";

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
  .object({ policyVersion: ConsentPolicyVersionSchema })
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

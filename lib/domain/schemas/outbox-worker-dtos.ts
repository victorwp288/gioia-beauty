import { z } from "zod";

import {
  NewsletterConfirmationTemplateDataSchema,
  RescheduleOutboxTemplateDataSchema,
  ScheduleOutboxTemplateDataSchema,
} from "./outbox-templates.ts";
import { ProviderIdSchema, WorkerIdSchema } from "./outbox-persistence.ts";
import {
  ErrorCodeSchema,
  IsoInstantSchema,
  NormalizedEmailSchema,
  PositiveVersionSchema,
  UuidSchema,
} from "./primitives.ts";

const claimFields = {
  outboxId: UuidSchema,
  aggregateId: UuidSchema,
  aggregateVersion: PositiveVersionSchema,
  recipientAddress: NormalizedEmailSchema,
  providerIdempotencyKey: z
    .string()
    .min(8)
    .max(255)
    .regex(/^[A-Za-z0-9._:-]{8,255}$/),
  attemptCount: z.number().int().min(1).max(20),
  expectedVersion: PositiveVersionSchema,
  leaseExpiresAt: IsoInstantSchema,
  firstProviderAttemptAt: IsoInstantSchema.nullable(),
  providerRetryDeadlineAt: IsoInstantSchema.nullable(),
};

function scheduleClaim(
  templateKind:
    | "booking_customer"
    | "booking_owner"
    | "cancellation_customer"
    | "cancellation_owner",
  recipientKind: "customer" | "owner",
) {
  return z
    .object({
      ...claimFields,
      aggregateKind: z.literal("schedule_entry"),
      recipientKind: z.literal(recipientKind),
      templateKind: z.literal(templateKind),
      templateData: ScheduleOutboxTemplateDataSchema,
    })
    .strict();
}

function rescheduleClaim(
  templateKind: "reschedule_customer" | "reschedule_owner",
  recipientKind: "customer" | "owner",
) {
  return z
    .object({
      ...claimFields,
      aggregateKind: z.literal("schedule_entry"),
      recipientKind: z.literal(recipientKind),
      templateKind: z.literal(templateKind),
      templateData: RescheduleOutboxTemplateDataSchema,
    })
    .strict();
}

export const OutboxClaimItemSchema = z.discriminatedUnion("templateKind", [
  scheduleClaim("booking_customer", "customer"),
  scheduleClaim("booking_owner", "owner"),
  scheduleClaim("cancellation_customer", "customer"),
  scheduleClaim("cancellation_owner", "owner"),
  rescheduleClaim("reschedule_customer", "customer"),
  rescheduleClaim("reschedule_owner", "owner"),
  z
    .object({
      ...claimFields,
      aggregateKind: z.literal("subscriber"),
      recipientKind: z.literal("subscriber"),
      templateKind: z.literal("newsletter_confirmation"),
      templateData: NewsletterConfirmationTemplateDataSchema,
    })
    .strict(),
]);

const completionFields = {
  outboxId: UuidSchema,
  attemptCount: z.number().int().min(1).max(20),
  currentVersion: PositiveVersionSchema,
};

export const OutboxCompletionSuccessResultSchema = z
  .object({ ...completionFields, deliveryStatus: z.literal("sent") })
  .strict();
export const OutboxCompletionFailureResultSchema = z
  .object({
    ...completionFields,
    deliveryStatus: z.enum(["failed", "dead_letter"]),
    nextAttemptAt: IsoInstantSchema,
  })
  .strict();

export const OutboxProviderAttemptResultSchema = z
  .object({
    outboxId: UuidSchema,
    allowed: z.boolean(),
    terminalReason: ErrorCodeSchema.nullable(),
    providerIdempotencyKey: z
      .string()
      .min(8)
      .max(255)
      .regex(/^[A-Za-z0-9._:-]{8,255}$/)
      .nullable(),
    firstProviderAttemptAt: IsoInstantSchema.nullable(),
    providerRetryDeadlineAt: IsoInstantSchema.nullable(),
    currentVersion: PositiveVersionSchema,
  })
  .strict()
  .superRefine((result, context) => {
    const complete =
      result.providerIdempotencyKey !== null &&
      result.firstProviderAttemptAt !== null &&
      result.providerRetryDeadlineAt !== null;
    if (
      result.allowed !== complete ||
      result.allowed === (result.terminalReason !== null)
    ) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Provider attempt disposition is inconsistent",
      });
    }
  });

export const VerifiedWebhookResultSchema = z
  .object({
    processingState: z.enum(["processed", "error"]),
    replayed: z.boolean(),
    errorCode: ErrorCodeSchema.nullable(),
  })
  .strict()
  .superRefine((result, context) => {
    if ((result.processingState === "error") !== (result.errorCode !== null)) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Webhook processing state and error code must agree",
        path: ["errorCode"],
      });
    }
  });

export const OutboxWorkerIdentitySchema = z
  .object({ workerId: WorkerIdSchema, providerMessageId: ProviderIdSchema })
  .strict();

export type OutboxClaimItem = z.infer<typeof OutboxClaimItemSchema>;

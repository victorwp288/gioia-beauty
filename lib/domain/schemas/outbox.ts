import { z } from "zod";

import { ProviderIdSchema, WorkerIdSchema } from "./outbox-persistence.ts";
import {
  ErrorCodeSchema,
  IsoInstantSchema,
  PositiveVersionSchema,
  Sha256Schema,
  SignedActionTokenSchema,
  UuidSchema,
} from "./primitives.ts";

const claimConfigurationFields = {
  batchSize: z.number().int().min(1).max(25).default(25),
  leaseSeconds: z.number().int().min(30).max(900).default(120),
};

export const OutboxClaimRequestSchema = z
  .object(claimConfigurationFields)
  .strict();

export const OutboxClaimInputSchema = z
  .object({
    workerId: WorkerIdSchema,
    ...claimConfigurationFields,
  })
  .strict();

const deliveryIdentityFields = {
  outboxId: UuidSchema,
  expectedVersion: PositiveVersionSchema,
  attemptCount: z.number().int().min(1).max(20),
  claimToken: SignedActionTokenSchema,
};

const OutboxDeliverySuccessSchema = z
  .object({
    ...deliveryIdentityFields,
    result: z.literal("sent"),
    providerMessageId: ProviderIdSchema,
  })
  .strict();

const OutboxDeliveryFailureSchema = z
  .object({
    ...deliveryIdentityFields,
    result: z.literal("failed"),
    errorCode: ErrorCodeSchema,
    retryable: z.boolean(),
  })
  .strict();

export const OutboxDeliveryResultSchema = z.discriminatedUnion("result", [
  OutboxDeliverySuccessSchema,
  OutboxDeliveryFailureSchema,
]);

export const OutboxWorkerReportSchema = z
  .object({
    workerId: WorkerIdSchema,
    results: z.array(OutboxDeliveryResultSchema).min(1).max(25),
  })
  .strict()
  .superRefine((report, context) => {
    const ids = report.results.map((result) => result.outboxId);
    if (new Set(ids).size !== ids.length) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Each outbox item may be completed only once per report",
        path: ["results"],
      });
    }
  });

const OutboxLogBaseSchema = z.object({
  outboxId: UuidSchema,
  attemptCount: z.number().int().min(0).max(20),
});
const OutboxLogWithoutErrorSchema = OutboxLogBaseSchema.extend({
  event: z.enum(["claimed", "sent"]),
  errorCode: z.null(),
}).strict();
const OutboxLogWithErrorSchema = OutboxLogBaseSchema.extend({
  event: z.enum(["retry_scheduled", "dead_lettered", "lease_recovered"]),
  errorCode: ErrorCodeSchema,
}).strict();

export const OutboxLogEventSchema = z.discriminatedUnion("event", [
  OutboxLogWithoutErrorSchema,
  OutboxLogWithErrorSchema,
]);

export const WebhookSignatureHeadersSchema = z
  .object({
    webhookId: ProviderIdSchema,
    webhookTimestamp: z.string().regex(/^\d{10,11}$/),
    webhookSignature: z
      .string()
      .trim()
      .min(16)
      .max(2048)
      .regex(/^v\d+,[A-Za-z0-9+/=_-]+(?:\s+v\d+,[A-Za-z0-9+/=_-]+)*$/),
  })
  .strict();

export const VerifiedEmailWebhookEventSchema = z
  .object({
    verifiedHeaders: WebhookSignatureHeadersSchema,
    signatureVerified: z.literal(true),
    providerMessageId: ProviderIdSchema.nullable(),
    eventKind: z.enum(["delivered", "bounced", "complained", "other"]),
    payloadSha256: Sha256Schema,
    receivedAt: IsoInstantSchema,
  })
  .strict()
  .transform(({ verifiedHeaders, ...event }) => ({
    ...event,
    providerEventId: verifiedHeaders.webhookId,
  }));

export function assertWebhookTimestampFresh(
  headers: z.infer<typeof WebhookSignatureHeadersSchema>,
  now: Date,
  maximumSkewSeconds = 300,
) {
  const webhookTime = Number(headers.webhookTimestamp) * 1000;
  if (
    !Number.isSafeInteger(webhookTime) ||
    Math.abs(now.getTime() - webhookTime) > maximumSkewSeconds * 1000
  ) {
    throw new RangeError(
      "Webhook timestamp is outside the accepted replay window",
    );
  }
  return headers;
}

export type OutboxClaimRequest = z.infer<typeof OutboxClaimRequestSchema>;
export type OutboxClaimInput = z.infer<typeof OutboxClaimInputSchema>;
export type OutboxDeliveryResult = z.infer<typeof OutboxDeliveryResultSchema>;
export type OutboxWorkerReport = z.infer<typeof OutboxWorkerReportSchema>;
export type VerifiedEmailWebhookEvent = z.infer<
  typeof VerifiedEmailWebhookEventSchema
>;
export type OutboxLogEvent = z.infer<typeof OutboxLogEventSchema>;
export type WebhookSignatureHeaders = z.infer<
  typeof WebhookSignatureHeadersSchema
>;

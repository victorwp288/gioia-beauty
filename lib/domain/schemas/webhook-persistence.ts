import { z } from "zod";

import { ProviderIdSchema } from "./outbox-persistence.ts";
import {
  ErrorCodeSchema,
  IsoInstantSchema,
  Sha256Schema,
} from "./primitives.ts";

export const EmailWebhookEventPersistenceSchema = z
  .object({
    providerEventId: ProviderIdSchema,
    providerMessageId: ProviderIdSchema.nullable(),
    eventKind: z.enum(["delivered", "bounced", "complained", "other"]),
    payloadSha256: Sha256Schema,
    signatureVerified: z.literal(true),
    receivedAt: IsoInstantSchema,
    processedAt: IsoInstantSchema.nullable(),
    processingErrorCode: ErrorCodeSchema.nullable(),
  })
  .strict()
  .superRefine((event, context) => {
    if (event.processedAt !== null && event.processingErrorCode !== null) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Processed webhook events cannot retain an error code",
        path: ["processingErrorCode"],
      });
    }
    if (event.processedAt !== null && event.processedAt < event.receivedAt) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Processing cannot precede receipt",
        path: ["processedAt"],
      });
    }
  });

export type EmailWebhookEventPersistence = z.infer<
  typeof EmailWebhookEventPersistenceSchema
>;

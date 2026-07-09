import { z } from "zod";

import {
  OutboxRecipientKindSchema,
  OutboxTemplateKindSchema,
} from "./outbox-templates.ts";
import { OutboxStatusSchema, ProviderIdSchema } from "./outbox-persistence.ts";
import {
  ErrorCodeSchema,
  IsoInstantSchema,
  NormalizedEmailSchema,
  PositiveVersionSchema,
  UuidSchema,
} from "./primitives.ts";

export const AdminOutboxDtoSchema = z
  .object({
    id: UuidSchema,
    aggregateKind: z.enum(["schedule_entry", "subscriber"]),
    aggregateId: UuidSchema,
    aggregateVersion: PositiveVersionSchema,
    recipientKind: OutboxRecipientKindSchema,
    recipientAddress: NormalizedEmailSchema,
    templateKind: OutboxTemplateKindSchema,
    status: OutboxStatusSchema,
    providerMessageId: ProviderIdSchema.nullable(),
    attemptCount: z.number().int().min(0).max(20),
    nextAttemptAt: IsoInstantSchema,
    lastErrorCode: ErrorCodeSchema.nullable(),
    sentAt: IsoInstantSchema.nullable(),
    version: PositiveVersionSchema,
    createdAt: IsoInstantSchema,
    updatedAt: IsoInstantSchema,
  })
  .strict()
  .superRefine((item, context) => {
    if (item.updatedAt < item.createdAt) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Updated timestamp cannot precede creation",
        path: ["updatedAt"],
      });
    }
  });

export type AdminOutboxDto = z.infer<typeof AdminOutboxDtoSchema>;

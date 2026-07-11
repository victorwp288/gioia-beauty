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
    const snapshotIsCompatible =
      (item.aggregateKind === "subscriber" &&
        item.recipientKind === "subscriber" &&
        item.templateKind === "newsletter_confirmation") ||
      (item.aggregateKind === "schedule_entry" &&
        ((item.recipientKind === "customer" &&
          [
            "booking_customer",
            "cancellation_customer",
            "reschedule_customer",
          ].includes(item.templateKind)) ||
          (item.recipientKind === "owner" &&
            [
              "booking_owner",
              "cancellation_owner",
              "reschedule_owner",
            ].includes(item.templateKind))));
    if (!snapshotIsCompatible) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Aggregate, recipient, and template must be compatible",
        path: ["templateKind"],
      });
    }

    const deliveryStateIsValid =
      (item.status === "pending" &&
        item.attemptCount === 0 &&
        item.providerMessageId === null &&
        item.lastErrorCode === null &&
        item.sentAt === null) ||
      (item.status === "sending" &&
        item.attemptCount > 0 &&
        item.providerMessageId === null &&
        item.lastErrorCode === null &&
        item.sentAt === null) ||
      (["failed", "dead_letter"].includes(item.status) &&
        item.attemptCount > 0 &&
        item.providerMessageId === null &&
        item.lastErrorCode !== null &&
        item.sentAt === null) ||
      (item.status === "sent" &&
        item.attemptCount > 0 &&
        item.providerMessageId !== null &&
        item.lastErrorCode === null &&
        item.sentAt !== null) ||
      (["bounced", "complained"].includes(item.status) &&
        item.attemptCount > 0 &&
        item.providerMessageId !== null &&
        item.lastErrorCode !== null &&
        item.sentAt !== null);
    if (!deliveryStateIsValid) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Delivery metadata must match outbox state",
        path: ["status"],
      });
    }
    if (item.updatedAt < item.createdAt) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Updated timestamp cannot precede creation",
        path: ["updatedAt"],
      });
    }
    if (item.sentAt !== null && item.sentAt < item.createdAt) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Sent timestamp cannot precede creation",
        path: ["sentAt"],
      });
    }
  });

export type AdminOutboxDto = z.infer<typeof AdminOutboxDtoSchema>;

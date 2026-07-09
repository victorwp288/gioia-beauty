import { z } from "zod";

import {
  NewsletterConfirmationTemplateDataSchema,
  RescheduleOutboxTemplateDataSchema,
  ScheduleOutboxTemplateDataSchema,
} from "./outbox-templates.ts";
import {
  ErrorCodeSchema,
  IsoInstantSchema,
  NormalizedEmailSchema,
  PositiveVersionSchema,
  UuidSchema,
} from "./primitives.ts";

export const ProviderIdSchema = z.string().trim().min(1).max(255);
export const WorkerIdSchema = z
  .string()
  .trim()
  .min(1)
  .max(100)
  .regex(/^[A-Za-z0-9:_-]+$/);
export const OutboxStatusSchema = z.enum([
  "pending",
  "sending",
  "sent",
  "failed",
  "dead_letter",
  "bounced",
  "complained",
]);

const commonFields = {
  id: UuidSchema,
  aggregateId: UuidSchema,
  aggregateVersion: PositiveVersionSchema,
  recipientAddress: NormalizedEmailSchema,
  idempotencyKey: z
    .string()
    .min(8)
    .max(255)
    .regex(/^[A-Za-z0-9._:-]{8,255}$/),
  status: OutboxStatusSchema,
  providerMessageId: ProviderIdSchema.nullable(),
  attemptCount: z.number().int().min(0).max(20),
  nextAttemptAt: IsoInstantSchema,
  lockedAt: IsoInstantSchema.nullable(),
  lockedBy: WorkerIdSchema.nullable(),
  leaseExpiresAt: IsoInstantSchema.nullable(),
  lastErrorCode: ErrorCodeSchema.nullable(),
  sentAt: IsoInstantSchema.nullable(),
  version: PositiveVersionSchema,
  createdAt: IsoInstantSchema,
  updatedAt: IsoInstantSchema,
};

function scheduleOutboxObject(
  templateKind:
    | "booking_customer"
    | "booking_owner"
    | "cancellation_customer"
    | "cancellation_owner",
  recipientKind: "customer" | "owner",
) {
  return z
    .object({
      ...commonFields,
      aggregateKind: z.literal("schedule_entry"),
      recipientKind: z.literal(recipientKind),
      templateKind: z.literal(templateKind),
      templateData: ScheduleOutboxTemplateDataSchema,
    })
    .strict();
}

function rescheduleOutboxObject(
  templateKind: "reschedule_customer" | "reschedule_owner",
  recipientKind: "customer" | "owner",
) {
  return z
    .object({
      ...commonFields,
      aggregateKind: z.literal("schedule_entry"),
      recipientKind: z.literal(recipientKind),
      templateKind: z.literal(templateKind),
      templateData: RescheduleOutboxTemplateDataSchema,
    })
    .strict();
}

const BookingCustomerOutboxSchema = scheduleOutboxObject(
  "booking_customer",
  "customer",
);
const BookingOwnerOutboxSchema = scheduleOutboxObject("booking_owner", "owner");
const CancellationCustomerOutboxSchema = scheduleOutboxObject(
  "cancellation_customer",
  "customer",
);
const CancellationOwnerOutboxSchema = scheduleOutboxObject(
  "cancellation_owner",
  "owner",
);
const RescheduleCustomerOutboxSchema = rescheduleOutboxObject(
  "reschedule_customer",
  "customer",
);
const RescheduleOwnerOutboxSchema = rescheduleOutboxObject(
  "reschedule_owner",
  "owner",
);
const NewsletterOutboxSchema = z
  .object({
    ...commonFields,
    aggregateKind: z.literal("subscriber"),
    recipientKind: z.literal("subscriber"),
    templateKind: z.literal("newsletter_confirmation"),
    templateData: NewsletterConfirmationTemplateDataSchema,
  })
  .strict();

const EmailOutboxPersistenceObjectSchema = z.discriminatedUnion(
  "templateKind",
  [
    BookingCustomerOutboxSchema,
    BookingOwnerOutboxSchema,
    CancellationCustomerOutboxSchema,
    CancellationOwnerOutboxSchema,
    RescheduleCustomerOutboxSchema,
    RescheduleOwnerOutboxSchema,
    NewsletterOutboxSchema,
  ],
);

type EmailOutboxCandidate = z.infer<typeof EmailOutboxPersistenceObjectSchema>;

function validateLock(
  candidate: EmailOutboxCandidate,
  context: z.RefinementCtx,
) {
  const lockValues = [
    candidate.lockedAt,
    candidate.lockedBy,
    candidate.leaseExpiresAt,
  ];
  const lockCount = lockValues.filter((value) => value !== null).length;

  if (
    (candidate.status === "sending" && lockCount !== 3) ||
    (candidate.status !== "sending" && lockCount !== 0)
  ) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      message: "Lease metadata must match sending state",
      path: ["status"],
    });
  }
  if (
    candidate.lockedAt !== null &&
    candidate.leaseExpiresAt !== null &&
    candidate.leaseExpiresAt <= candidate.lockedAt
  ) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      message: "Lease expiry must follow lock acquisition",
      path: ["leaseExpiresAt"],
    });
  }
}

function validateDeliveryState(
  candidate: EmailOutboxCandidate,
  context: z.RefinementCtx,
) {
  const valid =
    (candidate.status === "pending" &&
      candidate.attemptCount === 0 &&
      candidate.providerMessageId === null &&
      candidate.lastErrorCode === null &&
      candidate.sentAt === null) ||
    (candidate.status === "sending" &&
      candidate.attemptCount > 0 &&
      candidate.providerMessageId === null &&
      candidate.lastErrorCode === null &&
      candidate.sentAt === null) ||
    (["failed", "dead_letter"].includes(candidate.status) &&
      candidate.attemptCount > 0 &&
      candidate.providerMessageId === null &&
      candidate.lastErrorCode !== null &&
      candidate.sentAt === null) ||
    (candidate.status === "sent" &&
      candidate.attemptCount > 0 &&
      candidate.providerMessageId !== null &&
      candidate.lastErrorCode === null &&
      candidate.sentAt !== null) ||
    (["bounced", "complained"].includes(candidate.status) &&
      candidate.attemptCount > 0 &&
      candidate.providerMessageId !== null &&
      candidate.lastErrorCode !== null &&
      candidate.sentAt !== null);

  if (!valid) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      message: "Delivery metadata must match outbox state",
      path: ["status"],
    });
  }
}

export const EmailOutboxPersistenceSchema =
  EmailOutboxPersistenceObjectSchema.superRefine((candidate, context) => {
    validateLock(candidate, context);
    validateDeliveryState(candidate, context);
    if (candidate.updatedAt < candidate.createdAt) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Updated timestamp cannot precede creation",
        path: ["updatedAt"],
      });
    }
    if (candidate.sentAt !== null && candidate.sentAt < candidate.createdAt) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Sent timestamp cannot precede creation",
        path: ["sentAt"],
      });
    }
  });

export type EmailOutboxPersistence = z.infer<
  typeof EmailOutboxPersistenceSchema
>;

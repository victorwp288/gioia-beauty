import "server-only";

import { z } from "zod";

const Uuid = z.string().uuid();
const Instant = z.string().datetime({ offset: true });
const LocalDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/u);
const BoundedText = z.string().max(2_000);

const ChangeSchema = z
  .object({
    sequenceId: z.number().int().positive(),
    aggregateKind: z.enum(["schedule_entry", "vacation", "subscriber"]),
    aggregateId: Uuid,
    aggregateVersion: z.number().int().positive(),
    changeKind: z.enum([
      "create",
      "update",
      "reschedule",
      "cancel",
      "block",
      "subscribe",
      "unsubscribe",
    ]),
  })
  .strict();

const ScheduleSchema = z
  .object({
    id: Uuid,
    legacyFirestoreId: z.string().min(1).max(1_500).nullable(),
    kind: z.enum(["appointment", "block"]),
    status: z.enum([
      "confirmed",
      "completed",
      "cancelled",
      "no_show",
      "active",
    ]),
    localDate: LocalDate,
    startMinutes: z.number().int().min(0).max(1_439),
    serviceDurationMinutes: z.number().int().min(1).max(480),
    bufferMinutes: z.number().int().min(0).max(120),
    serviceNameSnapshot: z.string().min(1).max(160).nullable(),
    variantNameSnapshot: z.string().min(1).max(160).nullable(),
    clientName: z.string().min(1).max(160).nullable(),
    clientEmail: z.string().email().max(320).nullable(),
    clientPhone: z.string().max(40).nullable(),
    clientNote: BoundedText.nullable(),
    internalNote: BoundedText.nullable(),
    cancelledAt: Instant.nullable(),
    cancellationReason: z.string().max(1_000).nullable(),
    version: z.number().int().positive(),
    createdAt: Instant,
    updatedAt: Instant,
  })
  .strict()
  .superRefine((row, context) => {
    if (
      row.startMinutes + row.serviceDurationMinutes + row.bufferMinutes >
      1_440
    ) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Schedule entry crosses the legacy local-day boundary",
        path: ["startMinutes"],
      });
    }
    if (
      row.kind === "appointment" &&
      (row.status === "active" ||
        !row.clientName ||
        !row.serviceNameSnapshot ||
        !row.variantNameSnapshot)
    ) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message:
          "Appointment reverse rows require appointment fields and status",
        path: ["kind"],
      });
    }
    if (
      row.kind === "block" &&
      (!new Set(["active", "cancelled"]).has(row.status) ||
        row.clientName !== null ||
        row.clientEmail !== null ||
        row.clientPhone !== null ||
        row.clientNote !== null)
    ) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Block reverse rows require block status and no client fields",
        path: ["kind"],
      });
    }
    if ((row.status === "cancelled") !== (row.cancelledAt !== null)) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Schedule cancellation metadata must match status",
        path: ["cancelledAt"],
      });
    }
  });

const VacationSchema = z
  .object({
    id: Uuid,
    legacyFirestoreId: z.string().min(1).max(1_500).nullable(),
    startDate: LocalDate,
    endDate: LocalDate,
    status: z.enum(["active", "cancelled"]),
    reason: z.string().max(1_000).nullable(),
    cancelledAt: Instant.nullable(),
    version: z.number().int().positive(),
    createdAt: Instant,
    updatedAt: Instant,
  })
  .strict()
  .superRefine((row, context) => {
    if ((row.status === "cancelled") !== (row.cancelledAt !== null)) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Vacation cancellation metadata must match status",
        path: ["cancelledAt"],
      });
    }
  });

const SubscriberSchema = z
  .object({
    id: Uuid,
    legacyFirestoreId: z.string().min(1).max(1_500).nullable(),
    email: z.string().email().max(320),
    status: z.enum([
      "legacy_unverified",
      "pending",
      "active",
      "unsubscribed",
      "bounced",
      "complained",
    ]),
    unsubscribedAt: Instant.nullable(),
    version: z.number().int().positive(),
    createdAt: Instant,
    updatedAt: Instant,
  })
  .strict()
  .superRefine((row, context) => {
    if ((row.status === "unsubscribed") !== (row.unsubscribedAt !== null)) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Subscriber unsubscribe metadata must match status",
        path: ["unsubscribedAt"],
      });
    }
  });

export const LegacyFirestoreReverseInputSchema = z
  .object({
    afterSequence: z.number().int().nonnegative(),
    sourceHighWaterSequence: z.number().int().nonnegative(),
    sourceExhausted: z.boolean(),
    limit: z.number().int().min(1).max(500),
    changes: z.array(ChangeSchema).max(10_000),
    scheduleEntries: z.array(ScheduleSchema).max(10_000),
    vacations: z.array(VacationSchema).max(10_000),
    subscribers: z.array(SubscriberSchema).max(10_000),
  })
  .strict()
  .superRefine((input, context) => {
    if (input.afterSequence > input.sourceHighWaterSequence) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Reverse cursor exceeds the authoritative source high-water",
        path: ["afterSequence"],
      });
    }
    const pending = input.changes.filter(
      (change) => change.sequenceId > input.afterSequence,
    );
    if (
      input.changes.some(
        (change) => change.sequenceId > input.sourceHighWaterSequence,
      )
    ) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Reverse change exceeds the authoritative source high-water",
        path: ["changes"],
      });
    }
    const pendingSequences = [
      ...new Set(pending.map((item) => item.sequenceId)),
    ]
      .filter((sequence) => sequence <= input.sourceHighWaterSequence)
      .sort((left, right) => left - right);
    const expectedPendingCount =
      input.sourceHighWaterSequence - input.afterSequence;
    const exhaustivelyCoversWindow =
      pendingSequences.length === expectedPendingCount &&
      pendingSequences.every(
        (sequence, index) => sequence === input.afterSequence + index + 1,
      );
    if (input.sourceExhausted && !exhaustivelyCoversWindow) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message:
          "Exhausted reverse window does not cover its authoritative high-water",
        path: ["sourceExhausted"],
      });
    }
  });

export type LegacyFirestoreReverseInput = z.infer<
  typeof LegacyFirestoreReverseInputSchema
>;
export type LegacyFirestoreChange = z.infer<typeof ChangeSchema>;
export type LegacyFirestoreSchedule = z.infer<typeof ScheduleSchema>;

export interface LegacyFirestoreReverseOperation {
  readonly collection: "customers" | "vacations" | "newsletter_subscribers";
  readonly documentId: string;
  readonly sourceSequenceId: number;
  readonly aggregateId: string;
  readonly aggregateVersion: number;
  readonly action: "set" | "delete";
  readonly merge: boolean;
  readonly payload: Readonly<Record<string, unknown>> | null;
  readonly payloadSha256: string;
}

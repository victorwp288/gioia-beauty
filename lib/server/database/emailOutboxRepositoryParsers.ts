import "server-only";

import { z } from "zod";

import {
  ErrorCodeSchema,
  OutboxClaimItemSchema,
  OutboxCompletionFailureResultSchema,
  OutboxCompletionSuccessResultSchema,
  OutboxProviderAttemptResultSchema,
  type OutboxClaimItem,
} from "@/lib/domain/schemas/index.ts";

const TimestampSchema = z
  .union([z.date(), z.string().trim().min(1).max(64)])
  .transform((value, context) => {
    const date = value instanceof Date ? value : new Date(value);
    if (Number.isNaN(date.getTime())) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Invalid timestamp",
      });
      return z.NEVER;
    }
    return date.toISOString();
  });

const RawClaimRowSchema = z
  .object({
    selection_ordinal: z.number().int().min(1).max(25),
    selected_count: z.number().int().min(1).max(25),
    candidate_limit_reached: z.boolean(),
    outbox_id: z.unknown(),
    disposition: z.enum(["send", "dead_letter"]),
    terminal_reason: ErrorCodeSchema.nullable(),
    aggregate_kind: z.unknown().nullable(),
    aggregate_id: z.unknown().nullable(),
    aggregate_version: z.unknown().nullable(),
    recipient_kind: z.unknown().nullable(),
    recipient_address: z.unknown().nullable(),
    template_kind: z.string().nullable(),
    template_version: z.number().int().nullable(),
    template_data: z.unknown().nullable(),
    provider_idempotency_key: z.unknown().nullable(),
    attempt_count: z.unknown(),
    expected_version: z.unknown(),
    lease_expires_at: TimestampSchema.nullable(),
    first_provider_attempt_at: TimestampSchema.nullable(),
    provider_retry_deadline_at: TimestampSchema.nullable(),
  })
  .strict();

const ScheduleSchema = z
  .object({
    client_name: z.unknown(),
    local_date: z.unknown(),
    start_minutes: z.unknown(),
    service_duration_minutes: z.unknown(),
    service_name: z.unknown(),
    variant_name: z.unknown(),
  })
  .strict();
const RescheduleSchema = ScheduleSchema.extend({
  old_local_date: z.unknown(),
  old_start_minutes: z.unknown(),
}).strict();

function schedule(data: z.infer<typeof ScheduleSchema>) {
  return {
    clientName: data.client_name,
    localDate: data.local_date,
    startMinutes: data.start_minutes,
    serviceDurationMinutes: data.service_duration_minutes,
    serviceName: data.service_name,
    variantName: data.variant_name,
  };
}

function templateData(kind: string, value: unknown) {
  if (kind.startsWith("reschedule_")) {
    const data = RescheduleSchema.parse(value);
    return {
      ...schedule(data),
      oldLocalDate: data.old_local_date,
      oldStartMinutes: data.old_start_minutes,
    };
  }
  if (kind === "newsletter_confirmation") return value;
  return schedule(ScheduleSchema.parse(value));
}

export type EmailOutboxClaimBatch = Readonly<{
  selectedCount: number;
  budgetReached: boolean;
  claimDeadLettered: number;
  claims: readonly OutboxClaimItem[];
}>;

export function parseClaimRows(
  rows: Array<Record<string, unknown>>,
  batchSize: number,
): EmailOutboxClaimBatch {
  if (rows.length === 0) {
    return Object.freeze({
      selectedCount: 0,
      budgetReached: false,
      claimDeadLettered: 0,
      claims: [],
    });
  }
  if (rows.length > batchSize || rows.length > 25)
    throw new Error("Unexpected outbox claim result");
  try {
    const parsed = rows.map((row) => RawClaimRowSchema.parse(row));
    const selectedCount = parsed[0]!.selected_count;
    const budgetReached = parsed[0]!.candidate_limit_reached;
    if (
      selectedCount !== parsed.length ||
      parsed.some(
        (row, index) =>
          row.selection_ordinal !== index + 1 ||
          row.selected_count !== selectedCount ||
          row.candidate_limit_reached !== budgetReached,
      ) ||
      new Set(parsed.map((row) => row.outbox_id)).size !== parsed.length
    )
      throw new Error();

    const claims = parsed.flatMap((row) => {
      if (row.disposition === "dead_letter") {
        if (!row.terminal_reason) throw new Error();
        return [];
      }
      if (
        row.terminal_reason ||
        row.template_kind === null ||
        row.template_version !== 1 ||
        row.lease_expires_at === null
      )
        throw new Error();
      return [
        OutboxClaimItemSchema.parse({
          outboxId: row.outbox_id,
          aggregateKind: row.aggregate_kind,
          aggregateId: row.aggregate_id,
          aggregateVersion: row.aggregate_version,
          recipientKind: row.recipient_kind,
          recipientAddress: row.recipient_address,
          templateKind: row.template_kind,
          templateData: templateData(row.template_kind, row.template_data),
          providerIdempotencyKey: row.provider_idempotency_key,
          attemptCount: row.attempt_count,
          expectedVersion: row.expected_version,
          leaseExpiresAt: row.lease_expires_at,
          firstProviderAttemptAt: row.first_provider_attempt_at,
          providerRetryDeadlineAt: row.provider_retry_deadline_at,
        }),
      ];
    });
    return Object.freeze({
      selectedCount,
      budgetReached,
      claimDeadLettered: selectedCount - claims.length,
      claims: Object.freeze(claims),
    });
  } catch {
    throw new Error("Unexpected outbox claim result");
  }
}

function single(rows: Array<Record<string, unknown>>, message: string) {
  if (rows.length !== 1 || !rows[0]) throw new Error(message);
  return rows[0];
}

const CompletionSchema = z
  .object({
    outbox_id: z.unknown(),
    delivery_status: z.unknown(),
    attempt_count: z.unknown(),
    current_version: z.unknown(),
  })
  .strict();

export function parseCompletionSuccess(rows: Array<Record<string, unknown>>) {
  try {
    const row = CompletionSchema.parse(single(rows, ""));
    return OutboxCompletionSuccessResultSchema.parse({
      outboxId: row.outbox_id,
      deliveryStatus: row.delivery_status,
      attemptCount: row.attempt_count,
      currentVersion: row.current_version,
    });
  } catch {
    throw new Error("Unexpected outbox completion result");
  }
}

export function parseCompletionFailure(rows: Array<Record<string, unknown>>) {
  try {
    const row = CompletionSchema.extend({ next_attempt_at: TimestampSchema })
      .strict()
      .parse(single(rows, ""));
    return OutboxCompletionFailureResultSchema.parse({
      outboxId: row.outbox_id,
      deliveryStatus: row.delivery_status,
      attemptCount: row.attempt_count,
      currentVersion: row.current_version,
      nextAttemptAt: row.next_attempt_at,
    });
  } catch {
    throw new Error("Unexpected outbox completion result");
  }
}

export function parseProviderAttempt(rows: Array<Record<string, unknown>>) {
  try {
    const row = z
      .object({
        outbox_id: z.unknown(),
        allowed: z.boolean(),
        terminal_reason: ErrorCodeSchema.nullable(),
        provider_idempotency_key: z.unknown().nullable(),
        first_provider_attempt_at: TimestampSchema.nullable(),
        provider_retry_deadline_at: TimestampSchema.nullable(),
        current_version: z.unknown(),
      })
      .strict()
      .parse(single(rows, ""));
    return OutboxProviderAttemptResultSchema.parse({
      outboxId: row.outbox_id,
      allowed: row.allowed,
      terminalReason: row.terminal_reason,
      providerIdempotencyKey: row.provider_idempotency_key,
      firstProviderAttemptAt: row.first_provider_attempt_at,
      providerRetryDeadlineAt: row.provider_retry_deadline_at,
      currentVersion: row.current_version,
    });
  } catch {
    throw new Error("Unexpected outbox provider attempt result");
  }
}

import "server-only";

import { z } from "zod";

import {
  OutboxClaimInputSchema,
  OutboxClaimItemSchema,
  OutboxCompletionFailureResultSchema,
  OutboxCompletionSuccessResultSchema,
  ProviderIdSchema,
  UuidSchema,
  WorkerIdSchema,
  type OutboxClaimItem,
} from "@/lib/domain/schemas/index.ts";

import { createRuntimeDatabase, type RuntimeDatabase } from "./runtime.ts";

const CLAIM_QUERY = `
  select
    outbox_id,
    aggregate_kind,
    aggregate_id,
    aggregate_version,
    recipient_kind,
    recipient_address,
    template_kind,
    template_data,
    provider_idempotency_key,
    attempt_count,
    expected_version,
    lease_expires_at
  from gioia_private.claim_email_outbox($1, $2::smallint, $3::smallint)
  limit 25
`;

const COMPLETE_SUCCESS_QUERY = `
  select outbox_id, delivery_status, attempt_count, current_version
  from gioia_private.complete_email_outbox_success($1, $2, $3, $4)
  limit 2
`;

const COMPLETE_FAILURE_QUERY = `
  select
    outbox_id,
    delivery_status,
    attempt_count,
    current_version,
    next_attempt_at
  from gioia_private.complete_email_outbox_failure($1, $2, $3, $4, $5)
  limit 2
`;

const RawScheduleTemplateSchema = z
  .object({
    client_name: z.unknown(),
    local_date: z.unknown(),
    start_minutes: z.unknown(),
    service_duration_minutes: z.unknown(),
    service_name: z.unknown(),
    variant_name: z.unknown(),
  })
  .strict();

const RawRescheduleTemplateSchema = RawScheduleTemplateSchema.extend({
  old_local_date: z.unknown(),
  old_start_minutes: z.unknown(),
}).strict();

const RawNewsletterTemplateSchema = z
  .object({ policy_version: z.unknown() })
  .strict();

const DatabaseTimestampSchema = z
  .union([z.date(), z.string().trim().min(1).max(64)])
  .transform((value, context) => {
    const date = value instanceof Date ? value : new Date(value);
    if (Number.isNaN(date.getTime())) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Database timestamp is invalid",
      });
      return z.NEVER;
    }
    return date.toISOString();
  });

const RawClaimRowSchema = z
  .object({
    outbox_id: z.unknown(),
    aggregate_kind: z.unknown(),
    aggregate_id: z.unknown(),
    aggregate_version: z.unknown(),
    recipient_kind: z.unknown(),
    recipient_address: z.unknown(),
    template_kind: z.string(),
    template_data: z.unknown(),
    provider_idempotency_key: z.unknown(),
    attempt_count: z.unknown(),
    expected_version: z.unknown(),
    lease_expires_at: DatabaseTimestampSchema,
  })
  .strict();

const RawCompletionSuccessSchema = z
  .object({
    outbox_id: z.unknown(),
    delivery_status: z.unknown(),
    attempt_count: z.unknown(),
    current_version: z.unknown(),
  })
  .strict();

const RawCompletionFailureSchema = RawCompletionSuccessSchema.extend({
  next_attempt_at: DatabaseTimestampSchema,
}).strict();

const CompletionIdentitySchema = z
  .object({
    outboxId: UuidSchema,
    expectedVersion: z.number().int().min(1).max(2_147_483_647),
    workerId: WorkerIdSchema,
  })
  .strict();

const CompletionSuccessInputSchema = CompletionIdentitySchema.extend({
  providerMessageId: ProviderIdSchema,
}).strict();

const CompletionFailureInputSchema = CompletionIdentitySchema.extend({
  errorCode: z.string().regex(/^[A-Z][A-Z0-9_]{1,63}$/),
  retryable: z.boolean(),
}).strict();

function scheduleTemplateFields(
  data: z.infer<typeof RawScheduleTemplateSchema>,
) {
  return {
    clientName: data.client_name,
    localDate: data.local_date,
    startMinutes: data.start_minutes,
    serviceDurationMinutes: data.service_duration_minutes,
    serviceName: data.service_name,
    variantName: data.variant_name,
  };
}

function mapScheduleTemplate(value: unknown) {
  return scheduleTemplateFields(RawScheduleTemplateSchema.parse(value));
}

function mapTemplateData(templateKind: string, value: unknown) {
  if (templateKind.startsWith("reschedule_")) {
    const data = RawRescheduleTemplateSchema.parse(value);
    return {
      ...scheduleTemplateFields(data),
      oldLocalDate: data.old_local_date,
      oldStartMinutes: data.old_start_minutes,
    };
  }
  if (templateKind === "newsletter_confirmation") {
    const data = RawNewsletterTemplateSchema.parse(value);
    return { policyVersion: data.policy_version };
  }
  return mapScheduleTemplate(value);
}

function parseClaimRows(
  rows: Array<Record<string, unknown>>,
  batchSize: number,
): OutboxClaimItem[] {
  if (rows.length > batchSize || rows.length > 25) {
    throw new Error("Unexpected outbox claim result");
  }

  try {
    const parsed = rows.map((candidate) => {
      const row = RawClaimRowSchema.parse(candidate);
      return OutboxClaimItemSchema.parse({
        outboxId: row.outbox_id,
        aggregateKind: row.aggregate_kind,
        aggregateId: row.aggregate_id,
        aggregateVersion: row.aggregate_version,
        recipientKind: row.recipient_kind,
        recipientAddress: row.recipient_address,
        templateKind: row.template_kind,
        templateData: mapTemplateData(row.template_kind, row.template_data),
        providerIdempotencyKey: row.provider_idempotency_key,
        attemptCount: row.attempt_count,
        expectedVersion: row.expected_version,
        leaseExpiresAt: row.lease_expires_at,
      });
    });

    if (new Set(parsed.map((item) => item.outboxId)).size !== parsed.length) {
      throw new Error("Unexpected outbox claim result");
    }
    return parsed;
  } catch {
    throw new Error("Unexpected outbox claim result");
  }
}

function requireSingleRow(
  rows: Array<Record<string, unknown>>,
): Record<string, unknown> {
  if (rows.length !== 1 || !rows[0]) {
    throw new Error("Unexpected outbox completion result");
  }
  return rows[0];
}

function parseCompletionSuccess(rows: Array<Record<string, unknown>>) {
  try {
    const row = RawCompletionSuccessSchema.parse(requireSingleRow(rows));
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

function parseCompletionFailure(rows: Array<Record<string, unknown>>) {
  try {
    const row = RawCompletionFailureSchema.parse(requireSingleRow(rows));
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

export function createEmailOutboxRepository(
  database: Pick<RuntimeDatabase, "transaction"> = createRuntimeDatabase(),
) {
  return {
    async claim(input: z.input<typeof OutboxClaimInputSchema>) {
      const command = OutboxClaimInputSchema.parse(input);
      const rows = await database.transaction((transaction) =>
        transaction.unsafe(CLAIM_QUERY, [
          command.workerId,
          command.batchSize,
          command.leaseSeconds,
        ]),
      );
      return parseClaimRows(rows, command.batchSize);
    },

    async completeSuccess(input: z.input<typeof CompletionSuccessInputSchema>) {
      const command = CompletionSuccessInputSchema.parse(input);
      const rows = await database.transaction((transaction) =>
        transaction.unsafe(COMPLETE_SUCCESS_QUERY, [
          command.outboxId,
          command.expectedVersion,
          command.workerId,
          command.providerMessageId,
        ]),
      );
      return parseCompletionSuccess(rows);
    },

    async completeFailure(input: z.input<typeof CompletionFailureInputSchema>) {
      const command = CompletionFailureInputSchema.parse(input);
      const rows = await database.transaction((transaction) =>
        transaction.unsafe(COMPLETE_FAILURE_QUERY, [
          command.outboxId,
          command.expectedVersion,
          command.workerId,
          command.errorCode,
          command.retryable,
        ]),
      );
      return parseCompletionFailure(rows);
    },
  };
}

export type EmailOutboxRepository = ReturnType<
  typeof createEmailOutboxRepository
>;

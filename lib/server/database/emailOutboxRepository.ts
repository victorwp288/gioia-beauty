import "server-only";

import { z } from "zod";

import {
  OutboxClaimInputSchema,
  ProviderIdSchema,
  UuidSchema,
  WorkerIdSchema,
} from "@/lib/domain/schemas/index.ts";

import {
  parseClaimRows,
  parseCompletionFailure,
  parseCompletionSuccess,
  parseProviderAttempt,
} from "./emailOutboxRepositoryParsers.ts";
import { createRuntimeDatabase, type RuntimeDatabase } from "./runtime.ts";

const CLAIM_QUERY = `
  select selection_ordinal, selected_count, candidate_limit_reached,
    outbox_id, disposition, terminal_reason, aggregate_kind, aggregate_id,
    aggregate_version, recipient_kind, recipient_address, template_kind,
    template_version, template_data, provider_idempotency_key, attempt_count,
    expected_version, lease_expires_at, first_provider_attempt_at,
    provider_retry_deadline_at
  from gioia_private.claim_email_outbox($1, $2::smallint, $3::smallint)
  limit 25
`;

const BEGIN_PROVIDER_QUERY = `
  select outbox_id, allowed, terminal_reason, provider_idempotency_key,
    first_provider_attempt_at, provider_retry_deadline_at, current_version
  from gioia_private.begin_email_outbox_provider_attempt($1, $2, $3)
  limit 2
`;

const COMPLETE_SUCCESS_QUERY = `
  select outbox_id, delivery_status, attempt_count, current_version
  from gioia_private.complete_email_outbox_success($1, $2, $3, $4)
  limit 2
`;

const COMPLETE_PRE_PROVIDER_FAILURE_QUERY = `
  select outbox_id, delivery_status, attempt_count, current_version,
    next_attempt_at
  from gioia_private.complete_email_outbox_pre_provider_failure(
    $1, $2, $3, $4, $5
  )
  limit 2
`;

const COMPLETE_FAILURE_QUERY = `
  select outbox_id, delivery_status, attempt_count, current_version,
    next_attempt_at
  from gioia_private.complete_email_outbox_failure($1, $2, $3, $4, $5)
  limit 2
`;

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

export function createEmailOutboxRepository(
  database: Pick<RuntimeDatabase, "transaction"> = createRuntimeDatabase(),
) {
  const query = (sql: string, parameters: readonly unknown[]) =>
    database.transaction((transaction) => transaction.unsafe(sql, parameters));

  return {
    async claim(input: z.input<typeof OutboxClaimInputSchema>) {
      const command = OutboxClaimInputSchema.parse(input);
      return parseClaimRows(
        await query(CLAIM_QUERY, [
          command.workerId,
          command.batchSize,
          command.leaseSeconds,
        ]),
        command.batchSize,
      );
    },

    async beginProviderAttempt(input: unknown) {
      const command = CompletionIdentitySchema.parse(input);
      return parseProviderAttempt(
        await query(BEGIN_PROVIDER_QUERY, [
          command.outboxId,
          command.expectedVersion,
          command.workerId,
        ]),
      );
    },

    async completeSuccess(input: unknown) {
      const command = CompletionSuccessInputSchema.parse(input);
      return parseCompletionSuccess(
        await query(COMPLETE_SUCCESS_QUERY, [
          command.outboxId,
          command.expectedVersion,
          command.workerId,
          command.providerMessageId,
        ]),
      );
    },

    async completePreProviderFailure(input: unknown) {
      const command = CompletionFailureInputSchema.parse(input);
      return parseCompletionFailure(
        await query(COMPLETE_PRE_PROVIDER_FAILURE_QUERY, [
          command.outboxId,
          command.expectedVersion,
          command.workerId,
          command.errorCode,
          command.retryable,
        ]),
      );
    },

    async completeFailure(input: unknown) {
      const command = CompletionFailureInputSchema.parse(input);
      return parseCompletionFailure(
        await query(COMPLETE_FAILURE_QUERY, [
          command.outboxId,
          command.expectedVersion,
          command.workerId,
          command.errorCode,
          command.retryable,
        ]),
      );
    },
  };
}

export type EmailOutboxRepository = ReturnType<
  typeof createEmailOutboxRepository
>;

export const emailOutboxRepository = createEmailOutboxRepository();

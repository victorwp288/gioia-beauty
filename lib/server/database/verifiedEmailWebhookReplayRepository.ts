import "server-only";

import { z } from "zod";

import { createRuntimeDatabase, type RuntimeDatabase } from "./runtime.ts";

const RowSchema = z
  .object({
    selection_ordinal: z.number().int().min(1).max(25),
    selected_count: z.number().int().min(1).max(25),
    provider_event_id: z.string().min(1).max(255),
    processing_state: z.enum(["processed", "retry_scheduled", "terminal"]),
    error_code: z
      .enum(["PROVIDER_MESSAGE_NOT_FOUND", "WEBHOOK_REPLAY_EXHAUSTED"])
      .nullable(),
  })
  .strict();

const QUERY = `
  select selection_ordinal, selected_count, provider_event_id,
    processing_state, error_code
  from gioia_private.replay_pending_verified_email_webhooks($1::smallint)
  limit 25
`;

export function createVerifiedEmailWebhookReplayRepository(
  database: Pick<RuntimeDatabase, "transaction"> = createRuntimeDatabase(),
) {
  return {
    async replay(batchSize = 25) {
      const size = z.number().int().min(1).max(25).parse(batchSize);
      const rows = await database.transaction((transaction) =>
        transaction.unsafe(QUERY, [size]),
      );
      const parsed = rows.map((row) => RowSchema.parse(row));
      if (
        parsed.some(
          (row, index) =>
            row.selection_ordinal !== index + 1 ||
            row.selected_count !== parsed.length,
        )
      ) {
        throw new Error("Unexpected webhook replay result");
      }
      return Object.freeze({
        selectedCount: parsed.length,
        processedCount: parsed.filter(
          (row) => row.processing_state === "processed",
        ).length,
        pendingCount: parsed.filter(
          (row) => row.processing_state === "retry_scheduled",
        ).length,
        terminalCount: parsed.filter(
          (row) => row.processing_state === "terminal",
        ).length,
      });
    },
  };
}

export const verifiedEmailWebhookReplayRepository =
  createVerifiedEmailWebhookReplayRepository();

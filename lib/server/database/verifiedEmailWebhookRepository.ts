import "server-only";

import { z } from "zod";

import {
  IsoInstantSchema,
  ProviderIdSchema,
  Sha256Schema,
  VerifiedWebhookResultSchema,
  type VerifiedEmailWebhookEvent,
} from "@/lib/domain/schemas/index.ts";

import { createRuntimeDatabase, type RuntimeDatabase } from "./runtime.ts";

const PROCESS_VERIFIED_WEBHOOK_QUERY = `
  select processing_state, replayed, error_code
  from gioia_private.process_verified_email_webhook(
    $1::text, $2::text, $3::text, $4::bytea, $5::timestamptz
  )
  limit 2
`;

const VerifiedEventInputSchema = z
  .object({
    providerEventId: ProviderIdSchema,
    signatureVerified: z.literal(true),
    providerMessageId: ProviderIdSchema.nullable(),
    eventKind: z.enum(["delivered", "bounced", "complained", "other"]),
    payloadSha256: Sha256Schema,
    receivedAt: IsoInstantSchema,
  })
  .strict();

const RawResultSchema = z
  .object({
    processing_state: z.unknown(),
    replayed: z.unknown(),
    error_code: z.unknown(),
  })
  .strict();

function parseResult(rows: Array<Record<string, unknown>>) {
  if (rows.length !== 1 || !rows[0]) {
    throw new Error("Unexpected verified webhook result");
  }

  try {
    const row = RawResultSchema.parse(rows[0]);
    const result = VerifiedWebhookResultSchema.parse({
      processingState: row.processing_state,
      replayed: row.replayed,
      errorCode: row.error_code,
    });
    if (
      result.errorCode !== null &&
      !["MESSAGE_ID_REQUIRED", "PROVIDER_MESSAGE_NOT_FOUND"].includes(
        result.errorCode,
      )
    ) {
      throw new Error("Unexpected verified webhook result");
    }
    return result;
  } catch {
    throw new Error("Unexpected verified webhook result");
  }
}

export function createVerifiedEmailWebhookRepository(
  database: Pick<RuntimeDatabase, "transaction"> = createRuntimeDatabase(),
) {
  return {
    async processVerified(event: VerifiedEmailWebhookEvent) {
      const input = VerifiedEventInputSchema.parse(event);
      const rows = await database.transaction((transaction) =>
        transaction.unsafe(PROCESS_VERIFIED_WEBHOOK_QUERY, [
          input.providerEventId,
          input.providerMessageId,
          input.eventKind,
          Buffer.from(input.payloadSha256, "hex"),
          input.receivedAt,
        ]),
      );
      return parseResult(rows);
    },
  };
}

export const verifiedEmailWebhookRepository =
  createVerifiedEmailWebhookRepository();

export type VerifiedEmailWebhookRepository = ReturnType<
  typeof createVerifiedEmailWebhookRepository
>;

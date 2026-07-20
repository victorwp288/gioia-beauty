import "server-only";

import { z } from "zod";

import {
  IsoInstantSchema,
  UuidSchema,
  WorkerIdSchema,
} from "@/lib/domain/schemas/index.ts";

import { createRuntimeDatabase, type RuntimeDatabase } from "./runtime.ts";

const BigIntSchema = z
  .union([z.number().int(), z.string().regex(/^[0-9]+$/)])
  .transform((value, context) => {
    const number = Number(value);
    if (!Number.isSafeInteger(number) || number < 0) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Invalid sequence",
      });
      return z.NEVER;
    }
    return number;
  });

export const DeadLetterAlertEventSchema = z
  .object({
    sequenceId: BigIntSchema.pipe(z.number().positive()),
    outboxId: UuidSchema,
    reasonCode: z.string().regex(/^[A-Z][A-Z0-9_]{1,63}$/),
    origin: z.enum(["claim", "completion", "owner_retry", "historical"]),
    occurredAt: IsoInstantSchema,
  })
  .strict();

const ClaimRowSchema = z
  .object({
    batch_id: UuidSchema.nullable(),
    from_sequence_id: BigIntSchema.pipe(z.number().positive()).nullable(),
    through_sequence_id: BigIntSchema.pipe(z.number().positive()).nullable(),
    high_water_sequence_id: BigIntSchema,
    event_count: z.number().int().min(0).max(25),
    has_more: z.boolean(),
    lease_expires_at: IsoInstantSchema.nullable(),
    events: z.array(DeadLetterAlertEventSchema).max(25),
  })
  .strict();

const CLAIM_QUERY = `
  select batch_id, from_sequence_id, through_sequence_id,
    high_water_sequence_id, event_count, has_more, lease_expires_at, events
  from gioia_private.claim_email_dead_letter_alert_batch(
    $1::text, $2::smallint, $3::smallint
  )
  limit 2
`;
const ACK_QUERY = `
  select acked_sequence_id, high_water_sequence_id, has_more
  from gioia_private.ack_email_dead_letter_alert_batch($1::text, $2::uuid, $3::bigint)
  limit 2
`;

export function createEmailDeadLetterAlertRepository(
  database: Pick<RuntimeDatabase, "transaction"> = createRuntimeDatabase(),
) {
  const query = (sql: string, parameters: readonly unknown[]) =>
    database.transaction((transaction) => transaction.unsafe(sql, parameters));
  return {
    async claim(input: unknown) {
      const command = z
        .object({
          workerId: WorkerIdSchema,
          batchSize: z.number().int().min(1).max(25),
          leaseSeconds: z.number().int().min(30).max(900),
        })
        .strict()
        .parse(input);
      const rows = await query(CLAIM_QUERY, [
        command.workerId,
        command.batchSize,
        command.leaseSeconds,
      ]);
      if (rows.length !== 1 || !rows[0])
        throw new Error("Unexpected dead-letter alert claim");
      const row = ClaimRowSchema.parse(rows[0]);
      if (row.event_count !== row.events.length)
        throw new Error("Unexpected dead-letter alert claim");
      return Object.freeze({
        batchId: row.batch_id,
        fromSequenceId: row.from_sequence_id,
        throughSequenceId: row.through_sequence_id,
        highWaterSequenceId: row.high_water_sequence_id,
        eventCount: row.event_count,
        hasMore: row.has_more,
        leaseExpiresAt: row.lease_expires_at,
        events: Object.freeze(row.events),
      });
    },
    async ack(input: unknown) {
      const command = z
        .object({
          workerId: WorkerIdSchema,
          batchId: UuidSchema,
          throughSequenceId: z.number().int().positive(),
        })
        .strict()
        .parse(input);
      const rows = await query(ACK_QUERY, [
        command.workerId,
        command.batchId,
        command.throughSequenceId,
      ]);
      if (rows.length !== 1 || !rows[0])
        throw new Error("Unexpected dead-letter alert acknowledgement");
      return z
        .object({
          acked_sequence_id: BigIntSchema.pipe(z.number().positive()),
          high_water_sequence_id: BigIntSchema,
          has_more: z.boolean(),
        })
        .strict()
        .parse(rows[0]);
    },
  };
}

export const emailDeadLetterAlertRepository =
  createEmailDeadLetterAlertRepository();

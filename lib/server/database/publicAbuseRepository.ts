import "server-only";

import { z } from "zod";

import type { PublicAbuseAction } from "../publicAbuseBoundary.ts";
import { createRuntimeDatabase, type RuntimeDatabase } from "./runtime.ts";

const HashSchema = z.custom<Buffer>(
  (value) => Buffer.isBuffer(value) && value.byteLength === 32,
  "Expected a 32-byte hash",
);

const InputSchema = z
  .object({
    action: z.enum([
      "public_availability",
      "public_booking",
      "public_newsletter_subscribe",
      "public_newsletter_confirm",
      "public_newsletter_unsubscribe",
    ]),
    scopeKind: z.enum(["network", "account", "token"]),
    scopeHash: HashSchema,
    humanVerified: z.boolean(),
  })
  .strict();

const RowSchema = z
  .object({
    decision: z.enum([
      "allowed",
      "rate_limited",
      "human_verification_required",
    ]),
    allowed: z.boolean(),
    remaining: z.number().int().min(0).max(10_000),
    retry_after_seconds: z.number().int().min(0).max(86_400),
    human_verification_required: z.boolean(),
  })
  .strict()
  .superRefine((row, context) => {
    const valid =
      (row.decision === "allowed" &&
        row.allowed &&
        row.retry_after_seconds === 0 &&
        !row.human_verification_required) ||
      (row.decision === "rate_limited" &&
        !row.allowed &&
        row.remaining === 0 &&
        row.retry_after_seconds > 0 &&
        !row.human_verification_required) ||
      (row.decision === "human_verification_required" &&
        !row.allowed &&
        row.retry_after_seconds > 0 &&
        row.human_verification_required);
    if (!valid) {
      context.addIssue({
        code: "custom",
        message: "Inconsistent public abuse decision",
      });
    }
  });

const QUERY = `
  select decision, allowed, remaining, retry_after_seconds,
    human_verification_required
  from gioia_private.consume_public_abuse_bucket(
    $1::text, $2::text, 'public_v1'::text, $3::bytea, $4::boolean
  )
  limit 2
`;

const PURGE_QUERY = `
  select deleted_count, has_more
  from gioia_private.purge_expired_public_abuse_buckets($1::integer)
  limit 2
`;

const PurgeRowSchema = z
  .object({
    deleted_count: z.number().int().min(0).max(1_000),
    has_more: z.boolean(),
  })
  .strict();

const DATABASE_ACTION: Record<PublicAbuseAction, string> = {
  public_availability: "availability",
  public_booking: "booking",
  public_newsletter_subscribe: "newsletter_subscribe",
  public_newsletter_confirm: "newsletter_action",
  public_newsletter_unsubscribe: "newsletter_action",
};

export function createPublicAbuseRepository(
  database: Pick<RuntimeDatabase, "transaction"> = createRuntimeDatabase(),
) {
  return {
    async consume(input: unknown) {
      const parsed = InputSchema.parse(input);
      const rows = await database.transaction((transaction) =>
        transaction.unsafe(QUERY, [
          DATABASE_ACTION[parsed.action],
          parsed.scopeKind,
          Buffer.from(parsed.scopeHash),
          parsed.humanVerified,
        ]),
      );
      if (rows.length !== 1 || !rows[0]) {
        throw new Error("Unexpected public abuse decision");
      }
      const row = RowSchema.parse(rows[0]);
      return Object.freeze({
        decision: row.decision,
        allowed: row.allowed,
        remaining: row.remaining,
        retryAfterSeconds: row.retry_after_seconds,
        humanVerificationRequired: row.human_verification_required,
      });
    },

    async purgeExpired(limit = 1_000) {
      const boundedLimit = z.number().int().min(1).max(1_000).parse(limit);
      const rows = await database.transaction((transaction) =>
        transaction.unsafe(PURGE_QUERY, [boundedLimit]),
      );
      if (rows.length !== 1 || !rows[0]) {
        throw new Error("Unexpected public abuse purge result");
      }
      const row = PurgeRowSchema.parse(rows[0]);
      return Object.freeze({
        deletedCount: row.deleted_count,
        hasMore: row.has_more,
      });
    },
  };
}

export type PublicAbuseRepository = ReturnType<
  typeof createPublicAbuseRepository
>;

export const publicAbuseRepository = createPublicAbuseRepository();

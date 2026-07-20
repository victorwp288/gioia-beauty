import "server-only";

import { z } from "zod";

import type { RuntimeTransaction } from "./runtime.ts";

const CutoverWriteModeSchema = z.enum(["open", "frozen", "owner_reconcile"]);
const CutoverWriteStateRowSchema = z
  .object({
    mode: CutoverWriteModeSchema,
    version: z.number().int().positive(),
  })
  .strict();
const CutoverAuthorizationRowSchema = z
  .object({
    is_canary: z.boolean(),
    canary_run_id: z.string().uuid().nullable(),
    canary_grant_id: z.string().uuid().nullable(),
  })
  .strict();

export type CutoverWriteMode = z.infer<typeof CutoverWriteModeSchema>;
export type CutoverWriteState = z.infer<typeof CutoverWriteStateRowSchema>;

export interface CutoverWriteAuthorizationInput {
  readonly operation: string;
  readonly idempotencyKey: string;
  readonly requestFingerprint: Buffer;
  readonly canaryToken: string | null;
}

const STATE_QUERY = `
  select state.mode, state.version
  from gioia_private.get_cutover_write_state() as state
  limit 2
`;

const AUTHORIZE_QUERY = `
  select result.is_canary,
    result.canary_run_id,
    result.canary_grant_id
  from gioia_private.authorize_cutover_write(
    $1::text, $2::text, $3::bytea, $4::text
  ) as result
  limit 2
`;

function exactlyOne<T>(rows: readonly unknown[], schema: z.ZodType<T>): T {
  if (rows.length !== 1 || !rows[0]) {
    throw new Error("Unexpected cutover write-control result");
  }
  const parsed = schema.safeParse(rows[0]);
  if (!parsed.success) {
    throw new Error("Unexpected cutover write-control result");
  }
  return parsed.data;
}

export async function readCutoverWriteState(
  transaction: RuntimeTransaction,
): Promise<CutoverWriteState> {
  return exactlyOne(
    await transaction.unsafe(STATE_QUERY),
    CutoverWriteStateRowSchema,
  );
}

export async function authorizeCutoverWrite(
  transaction: RuntimeTransaction,
  input: CutoverWriteAuthorizationInput,
) {
  return exactlyOne(
    await transaction.unsafe(AUTHORIZE_QUERY, [
      input.operation,
      input.idempotencyKey,
      Buffer.from(input.requestFingerprint),
      input.canaryToken,
    ]),
    CutoverAuthorizationRowSchema,
  );
}

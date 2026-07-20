import "server-only";

import { z } from "zod";

import {
  ErrorCodeSchema,
  PostgresIntegerSchema,
  UuidSchema,
} from "@/lib/domain/schemas/index.ts";

import {
  ownerCommandFailureKey,
  type OwnerCommandContract,
} from "./ownerScheduleCommandContracts.ts";
import type { OwnerTransactionIdentity, RuntimeDatabase } from "./runtime.ts";
import { authorizeCutoverWrite } from "./cutoverWriteRepository.ts";

const OwnerIdentitySchema = z
  .object({ userId: UuidSchema, sessionId: UuidSchema })
  .strict();
const FingerprintSchema = z
  .custom<Buffer>((value) => Buffer.isBuffer(value))
  .refine((value) => value.byteLength === 32);
const PostgresVersionSchema = PostgresIntegerSchema.min(1);
const OwnerCommandRowSchema = z
  .object({
    http_status: z.number().int(),
    result: z
      .object({
        code: ErrorCodeSchema,
        resource_id: UuidSchema.optional(),
      })
      .strict(),
    replayed: z.boolean(),
  })
  .strict();

export type OwnerCommandResult = z.infer<typeof OwnerCommandRowSchema>;
export type OwnerScheduleCommandResult = OwnerCommandResult;

interface ExpectedResult extends OwnerCommandContract {
  readonly resourceId?: string;
}

export function parseOwnerCommandContext(
  identity: OwnerTransactionIdentity,
  requestFingerprint: Buffer,
) {
  const parsedIdentity = OwnerIdentitySchema.parse(identity);
  const parsedFingerprint = FingerprintSchema.parse(requestFingerprint);
  return {
    identity: parsedIdentity,
    requestFingerprint: Buffer.from(parsedFingerprint),
  };
}

export function parsePostgresVersion(value: unknown): number {
  return PostgresVersionSchema.parse(value);
}

function parseCommandResult(
  rows: Array<Record<string, unknown>>,
  expected: ExpectedResult,
): OwnerCommandResult {
  if (rows.length !== 1 || !rows[0]) {
    throw new Error("Unexpected owner command result");
  }
  const parsed = OwnerCommandRowSchema.safeParse(rows[0]);
  if (!parsed.success) {
    throw new Error("Unexpected owner command result");
  }

  const row = parsed.data;
  const resourceId = row.result.resource_id;
  const validSuccess =
    row.http_status === expected.httpStatus &&
    row.result.code === expected.code &&
    resourceId !== undefined &&
    (expected.resourceId === undefined || resourceId === expected.resourceId);
  const failureStatus = row.http_status;
  const validFailure =
    (failureStatus === 400 || failureStatus === 404 || failureStatus === 409) &&
    expected.failures.includes(
      ownerCommandFailureKey(failureStatus, row.result.code),
    ) &&
    resourceId === undefined;
  if (!validSuccess && !validFailure) {
    throw new Error("Unexpected owner command result");
  }
  return row;
}

export async function executeOwnerCommand(
  database: Pick<RuntimeDatabase, "ownerTransaction">,
  identity: OwnerTransactionIdentity,
  parameters: readonly unknown[],
  expected: ExpectedResult,
  canaryToken: string | null | undefined,
): Promise<OwnerCommandResult> {
  const idempotencyKey = parameters[1];
  const requestFingerprint = parameters[2];
  if (
    typeof idempotencyKey !== "string" ||
    !Buffer.isBuffer(requestFingerprint)
  ) {
    throw new Error("Invalid owner command cutover context");
  }
  const rows = await database.ownerTransaction(
    identity,
    async (transaction) => {
      await authorizeCutoverWrite(transaction, {
        operation: expected.operation,
        idempotencyKey,
        requestFingerprint,
        canaryToken: canaryToken ?? null,
      });
      return transaction.unsafe(expected.query, parameters);
    },
  );
  return parseCommandResult(rows, expected);
}

export const executeOwnerScheduleCommand = executeOwnerCommand;

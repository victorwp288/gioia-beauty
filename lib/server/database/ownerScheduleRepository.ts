import "server-only";

import { z } from "zod";

import {
  AdminCancelScheduleEntryCommandSchema,
  AdminCancelVacationCommandSchema,
  AdminCreateAppointmentCommandSchema,
  AdminCreateBlockCommandSchema,
  AdminCreateVacationCommandSchema,
  ErrorCodeSchema,
  PostgresIntegerSchema,
  UuidSchema,
} from "@/lib/domain/schemas/index.ts";

import {
  createRuntimeDatabase,
  type OwnerTransactionIdentity,
  type RuntimeDatabase,
} from "./runtime.ts";
import {
  OWNER_SCHEDULE_COMMAND_CONTRACTS,
  type OwnerScheduleCommandContract,
} from "./ownerScheduleCommandContracts.ts";

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

export type OwnerScheduleCommandResult = z.infer<typeof OwnerCommandRowSchema>;

export interface OwnerScheduleRepository {
  createAppointment(
    identity: OwnerTransactionIdentity,
    command: unknown,
    requestFingerprint: Buffer,
  ): Promise<OwnerScheduleCommandResult>;
  createBlock(
    identity: OwnerTransactionIdentity,
    command: unknown,
    requestFingerprint: Buffer,
  ): Promise<OwnerScheduleCommandResult>;
  cancelScheduleEntry(
    identity: OwnerTransactionIdentity,
    command: unknown,
    requestFingerprint: Buffer,
  ): Promise<OwnerScheduleCommandResult>;
  createVacation(
    identity: OwnerTransactionIdentity,
    command: unknown,
    requestFingerprint: Buffer,
  ): Promise<OwnerScheduleCommandResult>;
  cancelVacation(
    identity: OwnerTransactionIdentity,
    command: unknown,
    requestFingerprint: Buffer,
  ): Promise<OwnerScheduleCommandResult>;
}

interface ExpectedResult extends OwnerScheduleCommandContract {
  readonly resourceId?: string;
}

function parseContext(
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

function parseCommandResult(
  rows: Array<Record<string, unknown>>,
  expected: ExpectedResult,
): OwnerScheduleCommandResult {
  if (rows.length !== 1 || !rows[0]) {
    throw new Error("Unexpected owner schedule command result");
  }
  const parsed = OwnerCommandRowSchema.safeParse(rows[0]);
  if (!parsed.success) {
    throw new Error("Unexpected owner schedule command result");
  }

  const row = parsed.data;
  const resourceId = row.result.resource_id;
  const validSuccess =
    row.http_status === expected.httpStatus &&
    row.result.code === expected.code &&
    resourceId !== undefined &&
    (expected.resourceId === undefined || resourceId === expected.resourceId);
  const validFailure =
    expected.failures.get(row.result.code) === row.http_status &&
    resourceId === undefined;
  if (!validSuccess && !validFailure) {
    throw new Error("Unexpected owner schedule command result");
  }
  return row;
}

async function executeCommand(
  database: Pick<RuntimeDatabase, "ownerTransaction">,
  identity: OwnerTransactionIdentity,
  parameters: readonly unknown[],
  expected: ExpectedResult,
): Promise<OwnerScheduleCommandResult> {
  const rows = await database.ownerTransaction(identity, (transaction) =>
    transaction.unsafe(expected.query, parameters),
  );
  return parseCommandResult(rows, expected);
}

export function createOwnerScheduleRepository(
  database: Pick<RuntimeDatabase, "ownerTransaction"> = createRuntimeDatabase(),
): OwnerScheduleRepository {
  return {
    async createAppointment(identityInput, commandInput, fingerprintInput) {
      const { identity, requestFingerprint } = parseContext(
        identityInput,
        fingerprintInput,
      );
      const command = AdminCreateAppointmentCommandSchema.parse(commandInput);
      return executeCommand(
        database,
        identity,
        [
          identity.userId,
          command.idempotencyKey,
          requestFingerprint,
          command.date,
          command.startMinutes,
          command.serviceId,
          command.variantId,
          command.clientName,
          command.clientEmail,
          command.clientPhone,
          command.clientNote,
        ],
        OWNER_SCHEDULE_COMMAND_CONTRACTS.createAppointment,
      );
    },

    async createBlock(identityInput, commandInput, fingerprintInput) {
      const { identity, requestFingerprint } = parseContext(
        identityInput,
        fingerprintInput,
      );
      const command = AdminCreateBlockCommandSchema.parse(commandInput);
      return executeCommand(
        database,
        identity,
        [
          identity.userId,
          command.idempotencyKey,
          requestFingerprint,
          command.date,
          command.startMinutes,
          command.durationMinutes,
          command.bufferMinutes,
          command.internalNote,
        ],
        OWNER_SCHEDULE_COMMAND_CONTRACTS.createBlock,
      );
    },

    async cancelScheduleEntry(identityInput, commandInput, fingerprintInput) {
      const { identity, requestFingerprint } = parseContext(
        identityInput,
        fingerprintInput,
      );
      const command = AdminCancelScheduleEntryCommandSchema.parse(commandInput);
      const expectedVersion = PostgresVersionSchema.parse(
        command.expectedVersion,
      );
      return executeCommand(
        database,
        identity,
        [
          identity.userId,
          command.idempotencyKey,
          requestFingerprint,
          command.entryId,
          expectedVersion,
          command.reason,
        ],
        {
          ...OWNER_SCHEDULE_COMMAND_CONTRACTS.cancelScheduleEntry,
          resourceId: command.entryId,
        },
      );
    },

    async createVacation(identityInput, commandInput, fingerprintInput) {
      const { identity, requestFingerprint } = parseContext(
        identityInput,
        fingerprintInput,
      );
      const command = AdminCreateVacationCommandSchema.parse(commandInput);
      return executeCommand(
        database,
        identity,
        [
          identity.userId,
          command.idempotencyKey,
          requestFingerprint,
          command.startDate,
          command.endDate,
          command.reason,
        ],
        OWNER_SCHEDULE_COMMAND_CONTRACTS.createVacation,
      );
    },

    async cancelVacation(identityInput, commandInput, fingerprintInput) {
      const { identity, requestFingerprint } = parseContext(
        identityInput,
        fingerprintInput,
      );
      const command = AdminCancelVacationCommandSchema.parse(commandInput);
      const expectedVersion = PostgresVersionSchema.parse(
        command.expectedVersion,
      );
      return executeCommand(
        database,
        identity,
        [
          identity.userId,
          command.idempotencyKey,
          requestFingerprint,
          command.vacationId,
          expectedVersion,
        ],
        {
          ...OWNER_SCHEDULE_COMMAND_CONTRACTS.cancelVacation,
          resourceId: command.vacationId,
        },
      );
    },
  };
}

export const ownerScheduleRepository = createOwnerScheduleRepository();

import "server-only";

import {
  AdminCancelScheduleEntryCommandSchema,
  AdminCancelVacationCommandSchema,
  AdminCreateAppointmentCommandSchema,
  AdminCreateBlockCommandSchema,
  AdminCreateVacationCommandSchema,
} from "@/lib/domain/schemas/index.ts";

import { createOwnerScheduleEditMethods } from "./ownerScheduleEditRepository.ts";
import { OWNER_SCHEDULE_COMMAND_CONTRACTS } from "./ownerScheduleCommandContracts.ts";
import {
  executeOwnerScheduleCommand,
  parseOwnerCommandContext,
  parsePostgresVersion,
  type OwnerScheduleCommandResult,
} from "./ownerScheduleRepositorySupport.ts";
import {
  createRuntimeDatabase,
  type OwnerTransactionIdentity,
  type RuntimeDatabase,
} from "./runtime.ts";

export type { OwnerScheduleCommandResult } from "./ownerScheduleRepositorySupport.ts";

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
  updateAppointment(
    identity: OwnerTransactionIdentity,
    command: unknown,
    requestFingerprint: Buffer,
  ): Promise<OwnerScheduleCommandResult>;
  updateBlock(
    identity: OwnerTransactionIdentity,
    command: unknown,
    requestFingerprint: Buffer,
  ): Promise<OwnerScheduleCommandResult>;
  rescheduleAppointment(
    identity: OwnerTransactionIdentity,
    command: unknown,
    requestFingerprint: Buffer,
  ): Promise<OwnerScheduleCommandResult>;
  rescheduleBlock(
    identity: OwnerTransactionIdentity,
    command: unknown,
    requestFingerprint: Buffer,
  ): Promise<OwnerScheduleCommandResult>;
  setAppointmentStatus(
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

export function createOwnerScheduleRepository(
  database: Pick<RuntimeDatabase, "ownerTransaction"> = createRuntimeDatabase(),
): OwnerScheduleRepository {
  return {
    ...createOwnerScheduleEditMethods(database),
    async createAppointment(identityInput, commandInput, fingerprintInput) {
      const { identity, requestFingerprint } = parseOwnerCommandContext(
        identityInput,
        fingerprintInput,
      );
      const command = AdminCreateAppointmentCommandSchema.parse(commandInput);
      return executeOwnerScheduleCommand(
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
      const { identity, requestFingerprint } = parseOwnerCommandContext(
        identityInput,
        fingerprintInput,
      );
      const command = AdminCreateBlockCommandSchema.parse(commandInput);
      return executeOwnerScheduleCommand(
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
      const { identity, requestFingerprint } = parseOwnerCommandContext(
        identityInput,
        fingerprintInput,
      );
      const command = AdminCancelScheduleEntryCommandSchema.parse(commandInput);
      const expectedVersion = parsePostgresVersion(command.expectedVersion);
      return executeOwnerScheduleCommand(
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
      const { identity, requestFingerprint } = parseOwnerCommandContext(
        identityInput,
        fingerprintInput,
      );
      const command = AdminCreateVacationCommandSchema.parse(commandInput);
      return executeOwnerScheduleCommand(
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
      const { identity, requestFingerprint } = parseOwnerCommandContext(
        identityInput,
        fingerprintInput,
      );
      const command = AdminCancelVacationCommandSchema.parse(commandInput);
      const expectedVersion = parsePostgresVersion(command.expectedVersion);
      return executeOwnerScheduleCommand(
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

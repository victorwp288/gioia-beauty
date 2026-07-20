import "server-only";

import {
  AdminCancelScheduleEntryCommandSchema,
  AdminCancelVacationCommandSchema,
  AdminCreateAppointmentCommandSchema,
  AdminCreateBlockCommandSchema,
  AdminCreateVacationCommandSchema,
  AdminUpdateVacationCommandSchema,
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

type OwnerScheduleRepositoryMethod = (
  identity: OwnerTransactionIdentity,
  command: unknown,
  requestFingerprint: Buffer,
  canaryToken?: string | null,
) => Promise<OwnerScheduleCommandResult>;

export interface OwnerScheduleRepository {
  createAppointment: OwnerScheduleRepositoryMethod;
  createBlock: OwnerScheduleRepositoryMethod;
  updateAppointment: OwnerScheduleRepositoryMethod;
  updateBlock: OwnerScheduleRepositoryMethod;
  rescheduleAppointment: OwnerScheduleRepositoryMethod;
  rescheduleBlock: OwnerScheduleRepositoryMethod;
  setAppointmentStatus: OwnerScheduleRepositoryMethod;
  cancelScheduleEntry: OwnerScheduleRepositoryMethod;
  createVacation: OwnerScheduleRepositoryMethod;
  updateVacation: OwnerScheduleRepositoryMethod;
  cancelVacation: OwnerScheduleRepositoryMethod;
}

export function createOwnerScheduleRepository(
  database: Pick<RuntimeDatabase, "ownerTransaction"> = createRuntimeDatabase(),
): OwnerScheduleRepository {
  return {
    ...createOwnerScheduleEditMethods(database),
    async createAppointment(
      identityInput,
      commandInput,
      fingerprintInput,
      canaryToken,
    ) {
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
        canaryToken,
      );
    },

    async createBlock(
      identityInput,
      commandInput,
      fingerprintInput,
      canaryToken,
    ) {
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
        canaryToken,
      );
    },

    async cancelScheduleEntry(
      identityInput,
      commandInput,
      fingerprintInput,
      canaryToken,
    ) {
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
        canaryToken,
      );
    },

    async createVacation(
      identityInput,
      commandInput,
      fingerprintInput,
      canaryToken,
    ) {
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
        canaryToken,
      );
    },

    async cancelVacation(
      identityInput,
      commandInput,
      fingerprintInput,
      canaryToken,
    ) {
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
        canaryToken,
      );
    },

    async updateVacation(
      identityInput,
      commandInput,
      fingerprintInput,
      canaryToken,
    ) {
      const { identity, requestFingerprint } = parseOwnerCommandContext(
        identityInput,
        fingerprintInput,
      );
      const command = AdminUpdateVacationCommandSchema.parse(commandInput);
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
          command.startDate,
          command.endDate,
          command.reason,
        ],
        {
          ...OWNER_SCHEDULE_COMMAND_CONTRACTS.updateVacation,
          resourceId: command.vacationId,
        },
        canaryToken,
      );
    },
  };
}

export const ownerScheduleRepository = createOwnerScheduleRepository();

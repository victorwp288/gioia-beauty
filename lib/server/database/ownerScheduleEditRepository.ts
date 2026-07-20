import "server-only";

import {
  AdminRescheduleAppointmentCommandSchema,
  AdminRescheduleBlockCommandSchema,
  AdminSetAppointmentStatusCommandSchema,
  AdminUpdateAppointmentCommandSchema,
  AdminUpdateBlockCommandSchema,
} from "@/lib/domain/schemas/index.ts";

import { OWNER_SCHEDULE_COMMAND_CONTRACTS } from "./ownerScheduleCommandContracts.ts";
import type { OwnerScheduleRepository } from "./ownerScheduleRepository.ts";
import {
  executeOwnerScheduleCommand,
  parseOwnerCommandContext,
  parsePostgresVersion,
} from "./ownerScheduleRepositorySupport.ts";
import type { RuntimeDatabase } from "./runtime.ts";

export type OwnerScheduleEditMethodName =
  | "updateAppointment"
  | "updateBlock"
  | "rescheduleAppointment"
  | "rescheduleBlock"
  | "setAppointmentStatus";

function appointmentDetailsPatch(command: Record<string, unknown>): string {
  const patch: Record<string, unknown> = {};
  for (const [source, target] of [
    ["clientName", "client_name"],
    ["clientEmail", "client_email"],
    ["clientPhone", "client_phone"],
    ["clientNote", "client_note"],
    ["internalNote", "internal_note"],
  ] as const) {
    if (command[source] !== undefined) patch[target] = command[source];
  }
  return JSON.stringify(patch);
}

export function createOwnerScheduleEditMethods(
  database: Pick<RuntimeDatabase, "ownerTransaction">,
): Pick<OwnerScheduleRepository, OwnerScheduleEditMethodName> {
  return {
    async updateAppointment(
      identityInput,
      commandInput,
      fingerprintInput,
      canaryToken,
    ) {
      const { identity, requestFingerprint } = parseOwnerCommandContext(
        identityInput,
        fingerprintInput,
      );
      const command = AdminUpdateAppointmentCommandSchema.parse(commandInput);
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
          appointmentDetailsPatch(command),
        ],
        {
          ...OWNER_SCHEDULE_COMMAND_CONTRACTS.updateAppointment,
          resourceId: command.entryId,
        },
        canaryToken,
      );
    },

    async updateBlock(
      identityInput,
      commandInput,
      fingerprintInput,
      canaryToken,
    ) {
      const { identity, requestFingerprint } = parseOwnerCommandContext(
        identityInput,
        fingerprintInput,
      );
      const command = AdminUpdateBlockCommandSchema.parse(commandInput);
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
          command.internalNote,
        ],
        {
          ...OWNER_SCHEDULE_COMMAND_CONTRACTS.updateBlock,
          resourceId: command.entryId,
        },
        canaryToken,
      );
    },

    async rescheduleAppointment(
      identityInput,
      commandInput,
      fingerprintInput,
      canaryToken,
    ) {
      const { identity, requestFingerprint } = parseOwnerCommandContext(
        identityInput,
        fingerprintInput,
      );
      const command =
        AdminRescheduleAppointmentCommandSchema.parse(commandInput);
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
          command.date,
          command.startMinutes,
          command.serviceId,
          command.variantId,
        ],
        {
          ...OWNER_SCHEDULE_COMMAND_CONTRACTS.rescheduleAppointment,
          resourceId: command.entryId,
        },
        canaryToken,
      );
    },

    async rescheduleBlock(
      identityInput,
      commandInput,
      fingerprintInput,
      canaryToken,
    ) {
      const { identity, requestFingerprint } = parseOwnerCommandContext(
        identityInput,
        fingerprintInput,
      );
      const command = AdminRescheduleBlockCommandSchema.parse(commandInput);
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
          command.date,
          command.startMinutes,
          command.durationMinutes,
          command.bufferMinutes,
        ],
        {
          ...OWNER_SCHEDULE_COMMAND_CONTRACTS.rescheduleBlock,
          resourceId: command.entryId,
        },
        canaryToken,
      );
    },

    async setAppointmentStatus(
      identityInput,
      commandInput,
      fingerprintInput,
      canaryToken,
    ) {
      const { identity, requestFingerprint } = parseOwnerCommandContext(
        identityInput,
        fingerprintInput,
      );
      const command =
        AdminSetAppointmentStatusCommandSchema.parse(commandInput);
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
          command.status,
        ],
        {
          ...OWNER_SCHEDULE_COMMAND_CONTRACTS.setAppointmentStatus,
          resourceId: command.entryId,
        },
        canaryToken,
      );
    },
  };
}

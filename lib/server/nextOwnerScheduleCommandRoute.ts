import "server-only";

import type { z } from "zod";

import {
  AdminCancelScheduleEntryBodySchema,
  AdminCancelVacationBodySchema,
  AdminCreateAppointmentBodySchema,
  AdminCreateBlockBodySchema,
  AdminCreateVacationBodySchema,
  AdminRescheduleAppointmentBodySchema,
  AdminRescheduleBlockBodySchema,
  AdminSetAppointmentStatusBodySchema,
  AdminUpdateAppointmentBodySchema,
  AdminUpdateBlockBodySchema,
  AdminUpdateVacationBodySchema,
} from "@/lib/domain/schemas/index.ts";

import { OWNER_SCHEDULE_COMMAND_CONTRACTS } from "./database/ownerScheduleCommandContracts.ts";
import {
  ownerScheduleRepository,
  type OwnerScheduleRepository,
} from "./database/ownerScheduleRepository.ts";
import {
  createNextOwnerCommandRoute,
  type NextOwnerCommandRouteDependencies,
} from "./nextOwnerCommandRoute.ts";

export type OwnerScheduleCommandName = keyof OwnerScheduleRepository;

const COMMAND_BODY_SCHEMAS = Object.freeze({
  createAppointment: AdminCreateAppointmentBodySchema,
  createBlock: AdminCreateBlockBodySchema,
  updateAppointment: AdminUpdateAppointmentBodySchema,
  updateBlock: AdminUpdateBlockBodySchema,
  rescheduleAppointment: AdminRescheduleAppointmentBodySchema,
  rescheduleBlock: AdminRescheduleBlockBodySchema,
  setAppointmentStatus: AdminSetAppointmentStatusBodySchema,
  cancelScheduleEntry: AdminCancelScheduleEntryBodySchema,
  createVacation: AdminCreateVacationBodySchema,
  updateVacation: AdminUpdateVacationBodySchema,
  cancelVacation: AdminCancelVacationBodySchema,
});

export interface NextOwnerScheduleCommandRouteDependencies extends NextOwnerCommandRouteDependencies {
  readonly repository?: OwnerScheduleRepository;
}

export function createNextOwnerScheduleCommandRoute(
  commandName: OwnerScheduleCommandName,
  {
    repository = ownerScheduleRepository,
    ...routeDependencies
  }: NextOwnerScheduleCommandRouteDependencies = {},
) {
  const contract = OWNER_SCHEDULE_COMMAND_CONTRACTS[commandName];
  const bodySchema = COMMAND_BODY_SCHEMAS[commandName] as z.ZodType<
    Record<string, unknown>
  >;

  return createNextOwnerCommandRoute(
    {
      bodySchema,
      operation: contract.operation,
      version: contract.fingerprintVersion,
      execute: (identity, command, requestFingerprint, canaryToken) =>
        repository[commandName](
          identity,
          command,
          requestFingerprint,
          canaryToken,
        ),
    },
    routeDependencies,
  );
}

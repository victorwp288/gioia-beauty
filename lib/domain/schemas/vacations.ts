import { z } from "zod";

import { daysBetweenSalonDates } from "../booking/primitives.ts";
import {
  SchemaVersionSchema,
  persistenceIdentityFields,
  validateImportProvenance,
  validateInstantNotBefore,
  validateTimestampOrder,
} from "./persistence.ts";
import {
  IsoInstantSchema,
  PositiveVersionSchema,
  SalonDateSchema,
  UuidSchema,
  VacationReasonSchema,
} from "./primitives.ts";

export const VacationStatusSchema = z.enum(["active", "cancelled"]);
export const VacationSourceSchema = z.enum(["admin", "migration"]);

const vacationDomainFields = {
  startDate: SalonDateSchema,
  endDate: SalonDateSchema,
  status: VacationStatusSchema,
  reason: VacationReasonSchema,
  source: VacationSourceSchema,
  cancelledAt: IsoInstantSchema.nullable(),
  cancelledBy: UuidSchema.nullable(),
  version: PositiveVersionSchema,
};

const VacationPersistenceObjectSchema = z
  .object({
    ...persistenceIdentityFields,
    ...vacationDomainFields,
    createdBy: UuidSchema.nullable(),
  })
  .strict();

const AdminVacationDtoObjectSchema = z
  .object({
    id: UuidSchema,
    schemaVersion: SchemaVersionSchema,
    ...vacationDomainFields,
    createdAt: IsoInstantSchema,
    updatedAt: IsoInstantSchema,
  })
  .strict();

type VacationCandidate =
  | z.infer<typeof VacationPersistenceObjectSchema>
  | z.infer<typeof AdminVacationDtoObjectSchema>;

function validateVacation(
  candidate: VacationCandidate,
  context: z.RefinementCtx,
) {
  const days = daysBetweenSalonDates(candidate.startDate, candidate.endDate);
  if (days < 0 || days > 365) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      message: "Vacation must span between 1 and 366 inclusive dates",
      path: ["endDate"],
    });
  }

  const isCancelled = candidate.status === "cancelled";
  const adminCancellationComplete =
    candidate.source !== "admin" || candidate.cancelledBy !== null;
  if (
    isCancelled !== (candidate.cancelledAt !== null) ||
    (isCancelled && !adminCancellationComplete) ||
    (!isCancelled && candidate.cancelledBy !== null)
  ) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      message: "Cancellation metadata must match vacation status and source",
      path: ["status"],
    });
  }

  validateTimestampOrder(candidate, context);
  validateInstantNotBefore(
    candidate.cancelledAt,
    candidate.createdAt,
    "cancelledAt",
    context,
  );
}

export const VacationPersistenceSchema =
  VacationPersistenceObjectSchema.superRefine((vacation, context) => {
    validateVacation(vacation, context);
    validateImportProvenance(vacation, context);
    if (vacation.source === "admin" && vacation.createdBy === null) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Admin vacations require an owner identity",
        path: ["createdBy"],
      });
    }
  });

export const AdminVacationDtoSchema =
  AdminVacationDtoObjectSchema.superRefine(validateVacation);

export type VacationPersistence = z.infer<typeof VacationPersistenceSchema>;
export type AdminVacationDto = z.infer<typeof AdminVacationDtoSchema>;

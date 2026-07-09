import { z } from "zod";

import { SignedCursorTokenSchema } from "./cursors.ts";
import { AdminOutboxDtoSchema } from "./outbox-dtos.ts";
import {
  CatalogServiceIdSchema,
  CatalogVariantIdSchema,
  ErrorCodeSchema,
  NonnegativePostgresIntegerSchema,
  SalonDateSchema,
  StartMinutesSchema,
  UuidSchema,
} from "./primitives.ts";
import { AdminScheduleEntryDtoSchema } from "./schedule-dtos.ts";
import { AdminSubscriberDtoSchema } from "./subscribers.ts";
import { AdminVacationDtoSchema } from "./vacations.ts";

export const PublicAvailabilityResponseSchema = z
  .object({
    date: SalonDateSchema,
    serviceId: CatalogServiceIdSchema,
    variantId: CatalogVariantIdSchema,
    slots: z.array(StartMinutesSchema).max(96),
  })
  .strict()
  .superRefine((response, context) => {
    const uniqueSlots = new Set(response.slots);
    const sorted = response.slots.every(
      (slot, index) => index === 0 || response.slots[index - 1]! < slot,
    );
    if (
      uniqueSlots.size !== response.slots.length ||
      !sorted ||
      response.slots.some((slot) => slot % 15 !== 0)
    ) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message:
          "Availability slots must be unique, ordered, and 15-minute aligned",
        path: ["slots"],
      });
    }
  });

export const CommandResultResponseSchema = z
  .object({
    code: ErrorCodeSchema,
    resourceId: UuidSchema,
    replayed: z.boolean(),
  })
  .strict();

export const PublicAcceptedResponseSchema = z
  .object({
    code: z.literal("REQUEST_ACCEPTED"),
    replayed: z.boolean(),
  })
  .strict();

export const ApiErrorResponseSchema = z
  .object({
    code: ErrorCodeSchema,
    requestId: UuidSchema,
  })
  .strict();

const paginationResponseFields = {
  nextCursor: SignedCursorTokenSchema.nullable(),
};

export const AdminScheduleListResponseSchema = z
  .object({
    items: z.array(AdminScheduleEntryDtoSchema).max(100),
    ...paginationResponseFields,
  })
  .strict();

export const AdminVacationListResponseSchema = z
  .object({
    items: z.array(AdminVacationDtoSchema).max(100),
    ...paginationResponseFields,
  })
  .strict();

export const AdminSubscriberListResponseSchema = z
  .object({
    items: z.array(AdminSubscriberDtoSchema).max(100),
    ...paginationResponseFields,
  })
  .strict();

export const AdminOutboxListResponseSchema = z
  .object({
    items: z.array(AdminOutboxDtoSchema).max(100),
    ...paginationResponseFields,
  })
  .strict();

const countFields = {
  appointment: NonnegativePostgresIntegerSchema,
  block: NonnegativePostgresIntegerSchema,
};
const statusCountFields = {
  confirmed: NonnegativePostgresIntegerSchema,
  completed: NonnegativePostgresIntegerSchema,
  cancelled: NonnegativePostgresIntegerSchema,
  noShow: NonnegativePostgresIntegerSchema,
  active: NonnegativePostgresIntegerSchema,
};

export const ScheduleCountResponseSchema = z
  .object({
    fromDate: SalonDateSchema,
    toDate: SalonDateSchema,
    total: NonnegativePostgresIntegerSchema,
    byKind: z.object(countFields).strict(),
    byStatus: z.object(statusCountFields).strict(),
  })
  .strict()
  .superRefine((response, context) => {
    const byKindTotal = response.byKind.appointment + response.byKind.block;
    const byStatusTotal = Object.values(response.byStatus).reduce(
      (sum, count) => sum + count,
      0,
    );
    if (response.total !== byKindTotal || response.total !== byStatusTotal) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Schedule count dimensions must reconcile",
        path: ["total"],
      });
    }
  });

export type PublicAvailabilityResponse = z.infer<
  typeof PublicAvailabilityResponseSchema
>;
export type CommandResultResponse = z.infer<typeof CommandResultResponseSchema>;
export type PublicAcceptedResponse = z.infer<
  typeof PublicAcceptedResponseSchema
>;

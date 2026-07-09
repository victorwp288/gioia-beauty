import { z } from "zod";

import { daysBetweenSalonDates } from "../booking/primitives.ts";
import { SignedCursorTokenSchema } from "./cursors.ts";
import { OutboxStatusSchema } from "./outbox-persistence.ts";
import {
  CatalogServiceIdSchema,
  CatalogVariantIdSchema,
  SalonDateSchema,
} from "./primitives.ts";
import { AppointmentStatusSchema, BlockStatusSchema } from "./schedule.ts";
import { SubscriberStatusSchema } from "./subscribers.ts";

const dateRangeFields = {
  fromDate: SalonDateSchema,
  toDate: SalonDateSchema,
};
const paginationFields = {
  pageSize: z.number().int().min(1).max(100).default(50),
  cursor: SignedCursorTokenSchema.optional(),
};

function validateDateRange(
  range: {
    fromDate: z.infer<typeof SalonDateSchema>;
    toDate: z.infer<typeof SalonDateSchema>;
  },
  maximumDays: number,
  context: z.RefinementCtx,
) {
  const days = daysBetweenSalonDates(range.fromDate, range.toDate);
  if (days < 0 || days > maximumDays) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      message: `Date range must span at most ${maximumDays + 1} inclusive dates`,
      path: ["toDate"],
    });
  }
}

export const ScheduleStatusSchema = z.union([
  AppointmentStatusSchema,
  BlockStatusSchema,
]);

function validateUniqueValues(
  values: string[] | undefined,
  path: string,
  context: z.RefinementCtx,
) {
  if (values && new Set(values).size !== values.length) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      message: "Filter values must be unique",
      path: [path],
    });
  }
}

function validateScheduleFilters(
  query: {
    kind?: "appointment" | "block";
    statuses?: z.infer<typeof ScheduleStatusSchema>[];
  },
  context: z.RefinementCtx,
) {
  validateUniqueValues(query.statuses, "statuses", context);
  if (query.kind === "appointment" && query.statuses?.includes("active")) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      message: "Active is a block-only status",
      path: ["statuses"],
    });
  }
  if (
    query.kind === "block" &&
    query.statuses?.some((status) =>
      ["confirmed", "completed", "no_show"].includes(status),
    )
  ) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      message: "Appointment statuses cannot filter blocks",
      path: ["statuses"],
    });
  }
}

export const AvailabilityQuerySchema = z
  .object({
    date: SalonDateSchema,
    serviceId: CatalogServiceIdSchema,
    variantId: CatalogVariantIdSchema,
  })
  .strict();

const scheduleFilterFields = {
  kind: z.enum(["appointment", "block"]).optional(),
  statuses: z.array(ScheduleStatusSchema).min(1).max(5).optional(),
};

export const ScheduleListQuerySchema = z
  .object({
    ...dateRangeFields,
    ...scheduleFilterFields,
    ...paginationFields,
  })
  .strict()
  .superRefine((query, context) => {
    validateDateRange(query, 31, context);
    validateScheduleFilters(query, context);
  });

export const ScheduleCountQuerySchema = z
  .object({
    ...dateRangeFields,
    ...scheduleFilterFields,
  })
  .strict()
  .superRefine((query, context) => {
    validateDateRange(query, 31, context);
    validateScheduleFilters(query, context);
  });

export const ScheduleExportQuerySchema = z
  .object({
    ...dateRangeFields,
    format: z.literal("csv").default("csv"),
    includeNotes: z.boolean().default(false),
    pageSize: z.number().int().min(1).max(500).default(250),
    cursor: SignedCursorTokenSchema.optional(),
  })
  .strict()
  .superRefine((query, context) => validateDateRange(query, 365, context));

export const VacationListQuerySchema = z
  .object({ ...dateRangeFields, ...paginationFields })
  .strict()
  .superRefine((query, context) => validateDateRange(query, 365, context));

export const SubscriberListQuerySchema = z
  .object({
    statuses: z.array(SubscriberStatusSchema).min(1).max(6).optional(),
    ...paginationFields,
  })
  .strict()
  .superRefine((query, context) =>
    validateUniqueValues(query.statuses, "statuses", context),
  );

export const OutboxListQuerySchema = z
  .object({
    statuses: z.array(OutboxStatusSchema).min(1).max(7).optional(),
    ...paginationFields,
  })
  .strict()
  .superRefine((query, context) =>
    validateUniqueValues(query.statuses, "statuses", context),
  );

export type AvailabilityQuery = z.infer<typeof AvailabilityQuerySchema>;
export type ScheduleListQuery = z.infer<typeof ScheduleListQuerySchema>;
export type ScheduleCountQuery = z.infer<typeof ScheduleCountQuerySchema>;
export type ScheduleExportQuery = z.infer<typeof ScheduleExportQuerySchema>;
export type VacationListQuery = z.infer<typeof VacationListQuerySchema>;
export type SubscriberListQuery = z.infer<typeof SubscriberListQuerySchema>;
export type OutboxListQuery = z.infer<typeof OutboxListQuerySchema>;

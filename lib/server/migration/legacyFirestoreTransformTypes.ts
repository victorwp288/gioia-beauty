import { z } from "zod";

import type { ScheduleEntryPersistence } from "@/lib/domain/schemas/schedule.ts";
import type { SubscriberPersistence } from "@/lib/domain/schemas/subscribers.ts";
import type { VacationPersistence } from "@/lib/domain/schemas/vacations.ts";

export const SourceCollectionSchema = z.enum([
  "customers",
  "vacations",
  "newsletter_subscribers",
]);
export type LegacySourceCollection = z.infer<typeof SourceCollectionSchema>;

export const CatalogMappingSchema = z
  .object({
    legacyAppointmentType: z.string().trim().min(1).max(160),
    legacyVariant: z.string().trim().min(1).max(160).nullable(),
    serviceId: z.string().trim().min(1).max(100),
    variantId: z.string().trim().min(1).max(100),
  })
  .strict();

export const FirestoreTimestampSchema = z.union([
  z
    .object({
      seconds: z.number().int().safe(),
      nanoseconds: z.number().int().min(0).max(999_999_999),
    })
    .strict(),
  z
    .object({
      _seconds: z.number().int().safe(),
      _nanoseconds: z.number().int().min(0).max(999_999_999),
    })
    .strict(),
]);

const LegacyDateValueSchema = z.union([z.string(), FirestoreTimestampSchema]);
const LegacyInstantValueSchema = z.union([
  z.string(),
  FirestoreTimestampSchema,
]);

export const LegacyCustomerDataSchema = z
  .object({
    name: z.string().optional(),
    email: z.string().optional(),
    number: z.string().optional(),
    phone: z.string().optional(),
    appointmentType: z.string().optional(),
    variant: z.union([z.string(), z.number()]).optional(),
    selectedDate: LegacyDateValueSchema,
    date: LegacyDateValueSchema.optional(),
    startTime: z.string(),
    timeSlot: z.string().optional(),
    endTime: z.string().optional(),
    duration: z.number().optional(),
    totalDuration: z.number().optional(),
    note: z.string().optional(),
    internalNote: z.string().optional(),
    status: z.string().optional(),
    isTimeBlock: z.boolean().optional(),
    isSubscribedToNewsletter: z.boolean().optional(),
    createdAt: LegacyInstantValueSchema.optional(),
    updatedAt: LegacyInstantValueSchema.optional(),
    cancelledAt: LegacyInstantValueSchema.optional(),
    cancellationReason: z.string().optional(),
  })
  .strict();

export const LegacyVacationDataSchema = z
  .object({
    startDate: LegacyDateValueSchema,
    endDate: LegacyDateValueSchema,
    reason: z.string().optional(),
    status: z.string().optional(),
    createdAt: LegacyInstantValueSchema.optional(),
    updatedAt: LegacyInstantValueSchema.optional(),
    cancelledAt: LegacyInstantValueSchema.optional(),
  })
  .strict();

export const LegacySubscriberDataSchema = z
  .object({
    email: z.string(),
    name: z.string().optional(),
    status: z.string().optional(),
    source: z.string().optional(),
    subscribedAt: LegacyInstantValueSchema.optional(),
    subscribed_at: LegacyInstantValueSchema.optional(),
    createdAt: LegacyInstantValueSchema.optional(),
    updatedAt: LegacyInstantValueSchema.optional(),
    statusUpdatedAt: LegacyInstantValueSchema.optional(),
    unsubscribedAt: LegacyInstantValueSchema.optional(),
    statusReason: z.string().optional(),
  })
  .strict();

export type LegacyQuarantineReasonCode =
  | "AMBIGUOUS_CATALOG_MAPPING"
  | "DUPLICATE_NORMALIZED_EMAIL"
  | "INVALID_APPOINTMENT_STATUS"
  | "INVALID_BLOCK_STATUS"
  | "INVALID_CUSTOMER_CONTACT"
  | "INCONSISTENT_LEGACY_REDUNDANCY"
  | "INVALID_SALON_DATE"
  | "INVALID_SOURCE_SHAPE"
  | "INVALID_START_TIME"
  | "INVALID_SUBSCRIBER_EMAIL"
  | "INVALID_SUBSCRIBER_STATUS"
  | "INVALID_TARGET_RECORD"
  | "INVALID_VACATION_RANGE"
  | "INVALID_VACATION_STATUS"
  | "MISSING_BLOCK_DURATION_MAPPING"
  | "UNMAPPED_CATALOG"
  | "UNRESOLVED_TIMESTAMP_DATE";

export interface LegacyQuarantineRecord {
  readonly sourceCollection: LegacySourceCollection;
  readonly sourceRecordId: string;
  readonly sourceRecordSha256: string;
  readonly reasonCode: LegacyQuarantineReasonCode;
  readonly fieldCodes: readonly string[];
}

export interface LegacyImportedRecord<T> {
  readonly sourceCollection: LegacySourceCollection;
  readonly sourceRecordId: string;
  readonly sourceRecordSha256: string;
  readonly targetKind: "schedule_entry" | "vacation" | "subscriber";
  readonly targetId: string;
  readonly record: T;
}

export interface LegacyFirestoreTransformResult {
  readonly imported: readonly LegacyImportedRecord<
    ScheduleEntryPersistence | VacationPersistence | SubscriberPersistence
  >[];
  readonly quarantine: readonly LegacyQuarantineRecord[];
  readonly counts: {
    readonly source: number;
    readonly imported: number;
    readonly quarantined: number;
  };
}

export interface TransformContext {
  readonly importedAt: string;
  readonly dateResolutions: ReadonlyMap<string, string>;
  readonly blockDurations: ReadonlyMap<
    string,
    { serviceDurationMinutes: number; bufferMinutes: number }
  >;
  readonly catalogMappings: readonly z.output<typeof CatalogMappingSchema>[];
  readonly trustedTimestamps: ReadonlySet<string>;
}

export class RecordQuarantine extends Error {
  constructor(
    readonly reasonCode: LegacyQuarantineReasonCode,
    readonly fieldCodes: readonly string[],
  ) {
    super(reasonCode);
    this.name = "RecordQuarantine";
  }
}

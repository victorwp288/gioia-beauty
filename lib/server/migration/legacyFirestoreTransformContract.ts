import { z } from "zod";

import { SERVICE_CATALOG } from "@/lib/domain/catalog/index.ts";
import {
  CatalogMappingSchema,
  SourceCollectionSchema,
} from "./legacyFirestoreTransformTypes.ts";
export {
  CatalogMappingSchema,
  FirestoreTimestampSchema,
  LegacyCustomerDataSchema,
  LegacySubscriberDataSchema,
  LegacyVacationDataSchema,
  RecordQuarantine,
  SourceCollectionSchema,
} from "./legacyFirestoreTransformTypes.ts";
export type {
  LegacyFirestoreTransformResult,
  LegacyImportedRecord,
  LegacyQuarantineReasonCode,
  LegacyQuarantineRecord,
  LegacySourceCollection,
  TransformContext,
} from "./legacyFirestoreTransformTypes.ts";

export const MAX_COLLECTION_RECORDS = 2_500;
export const MAX_BATCH_RECORDS = 5_000;
export const FIRESTORE_ID_MAX_BYTES = 1_500;
export const DATE_ONLY_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

const JsonValueSchema: z.ZodType<unknown> = z.lazy(() =>
  z.union([
    z.null(),
    z.boolean(),
    z.number().finite(),
    z.string(),
    z.array(JsonValueSchema),
    z.record(JsonValueSchema),
  ]),
);

export const LegacyDocumentSchema = z
  .object({
    id: z
      .string()
      .min(1)
      .refine(
        (value) => Buffer.byteLength(value, "utf8") <= FIRESTORE_ID_MAX_BYTES,
        "Source document ID exceeds the byte bound",
      ),
    data: JsonValueSchema,
  })
  .strict();
export type LegacyDocument = z.output<typeof LegacyDocumentSchema>;

export const LegacyFirestoreBatchSchema = z
  .object({
    importedAt: z.string().datetime({ offset: true }),
    customers: z.array(LegacyDocumentSchema).max(MAX_COLLECTION_RECORDS),
    vacations: z.array(LegacyDocumentSchema).max(MAX_COLLECTION_RECORDS),
    newsletterSubscribers: z
      .array(LegacyDocumentSchema)
      .max(MAX_COLLECTION_RECORDS),
  })
  .strict()
  .superRefine((batch, context) => {
    const collections = [
      ["customers", batch.customers],
      ["vacations", batch.vacations],
      ["newsletterSubscribers", batch.newsletterSubscribers],
    ] as const;
    const total = collections.reduce(
      (count, [, records]) => count + records.length,
      0,
    );
    if (total > MAX_BATCH_RECORDS) {
      context.addIssue({
        code: z.ZodIssueCode.too_big,
        maximum: MAX_BATCH_RECORDS,
        type: "array",
        inclusive: true,
        exact: false,
        message: `A transform batch cannot exceed ${MAX_BATCH_RECORDS} records`,
        path: [],
      });
    }
    for (const [collectionName, records] of collections) {
      const ids = new Set<string>();
      records.forEach((record, index) => {
        if (ids.has(record.id)) {
          context.addIssue({
            code: z.ZodIssueCode.custom,
            message: "Source document IDs must be unique within a collection",
            path: [collectionName, index, "id"],
          });
        }
        ids.add(record.id);
      });
    }
  });

function isRealDate(value: string): boolean {
  if (!DATE_ONLY_PATTERN.test(value) || value.startsWith("0000-")) return false;
  const [yearText, monthText, dayText] = value.split("-");
  const date = new Date(0);
  date.setUTCHours(0, 0, 0, 0);
  date.setUTCFullYear(Number(yearText), Number(monthText) - 1, Number(dayText));
  return (
    date.getUTCFullYear() === Number(yearText) &&
    date.getUTCMonth() === Number(monthText) - 1 &&
    date.getUTCDate() === Number(dayText)
  );
}

function normalizeLookup(value: string): string {
  return value.normalize("NFC").trim().replace(/\s+/g, " ").toLowerCase();
}

function ensureUniqueOption<T>(
  values: readonly T[],
  keyFor: (value: T) => string,
  path: string,
  context: z.RefinementCtx,
): void {
  const keys = new Set<string>();
  values.forEach((value, index) => {
    const key = keyFor(value);
    if (keys.has(key)) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Mapping keys must be unique",
        path: [path, index],
      });
    }
    keys.add(key);
  });
}

const TimestampDateResolutionSchema = z
  .object({
    collection: z.enum(["customers", "vacations"]),
    sourceId: z.string().min(1).max(FIRESTORE_ID_MAX_BYTES),
    field: z.enum(["selectedDate", "startDate", "endDate"]),
    salonDate: z
      .string()
      .regex(DATE_ONLY_PATTERN)
      .refine(isRealDate, "Invalid salon date"),
  })
  .strict();

const BlockDurationMappingSchema = z
  .object({
    sourceId: z.string().min(1).max(FIRESTORE_ID_MAX_BYTES),
    serviceDurationMinutes: z.number().int().min(1).max(480),
    bufferMinutes: z.number().int().min(0).max(120).default(0),
  })
  .strict();

const TrustedTimestampRecordSchema = z
  .object({
    collection: SourceCollectionSchema,
    sourceId: z.string().min(1).max(FIRESTORE_ID_MAX_BYTES),
  })
  .strict();

export const LegacyFirestoreTransformOptionsSchema = z
  .object({
    timestampDateResolutions: z
      .array(TimestampDateResolutionSchema)
      .max(MAX_BATCH_RECORDS)
      .default([]),
    blockDurationMappings: z
      .array(BlockDurationMappingSchema)
      .max(MAX_COLLECTION_RECORDS)
      .default([]),
    catalogMappings: z
      .array(CatalogMappingSchema)
      .max(MAX_COLLECTION_RECORDS)
      .default([]),
    trustedTimestampRecords: z
      .array(TrustedTimestampRecordSchema)
      .max(MAX_BATCH_RECORDS)
      .default([]),
  })
  .strict()
  .superRefine((options, context) => {
    ensureUniqueOption(
      options.timestampDateResolutions,
      (item) => `${item.collection}\0${item.sourceId}\0${item.field}`,
      "timestampDateResolutions",
      context,
    );
    ensureUniqueOption(
      options.blockDurationMappings,
      (item) => item.sourceId,
      "blockDurationMappings",
      context,
    );
    ensureUniqueOption(
      options.catalogMappings,
      (item) =>
        `${normalizeLookup(item.legacyAppointmentType)}\0${normalizeLookup(
          item.legacyVariant ?? "",
        )}`,
      "catalogMappings",
      context,
    );
    options.catalogMappings.forEach((mapping, index) => {
      const service = SERVICE_CATALOG.services.find(
        (candidate) => candidate.id === mapping.serviceId,
      );
      if (
        !service ||
        !service.variants.some(
          (candidate) => candidate.id === mapping.variantId,
        )
      ) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          message:
            "Catalog mapping must reference an existing service/variant pair",
          path: ["catalogMappings", index],
        });
      }
    });
    ensureUniqueOption(
      options.trustedTimestampRecords,
      (item) => `${item.collection}\0${item.sourceId}`,
      "trustedTimestampRecords",
      context,
    );
  });

export type LegacyFirestoreBatch = z.input<typeof LegacyFirestoreBatchSchema>;
export type LegacyFirestoreTransformOptions = z.input<
  typeof LegacyFirestoreTransformOptionsSchema
>;

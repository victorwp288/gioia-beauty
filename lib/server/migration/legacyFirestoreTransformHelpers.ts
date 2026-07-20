import { createHash } from "node:crypto";

import { z } from "zod";

import {
  CatalogMappingSchema,
  DATE_ONLY_PATTERN,
  FirestoreTimestampSchema,
  LegacyFirestoreTransformOptionsSchema,
  RecordQuarantine,
  type LegacyDocument,
  type LegacyImportedRecord,
  type LegacyQuarantineRecord,
  type LegacySourceCollection,
  type TransformContext,
} from "./legacyFirestoreTransformContract.ts";

const CLOCK_PATTERN = /^(\d{2}):(\d{2})$/;
const UUID_NAMESPACE = "gioia:legacy-firestore-transform:v1";

export function normalizeLookup(value: string): string {
  return value.normalize("NFC").trim().replace(/\s+/g, " ").toLowerCase();
}

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

function canonicalJson(value: unknown): string {
  if (value === null) return "null";
  if (typeof value === "string" || typeof value === "boolean") {
    return JSON.stringify(value);
  }
  if (typeof value === "number") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  const record = value as Record<string, unknown>;
  return `{${Object.keys(record)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${canonicalJson(record[key])}`)
    .join(",")}}`;
}

export function sourceSha256(data: unknown): string {
  return createHash("sha256").update(canonicalJson(data), "utf8").digest("hex");
}

export function deterministicUuid(
  collection: LegacySourceCollection,
  id: string,
): string {
  const bytes = createHash("sha256")
    .update(`${UUID_NAMESPACE}\0${collection}\0${id}`, "utf8")
    .digest()
    .subarray(0, 16);
  bytes[6] = ((bytes[6] ?? 0) & 0x0f) | 0x50;
  bytes[8] = ((bytes[8] ?? 0) & 0x3f) | 0x80;
  const hex = bytes.toString("hex");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(
    12,
    16,
  )}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

function timestampToInstant(
  value: z.infer<typeof FirestoreTimestampSchema>,
): string | null {
  const parts =
    "seconds" in value
      ? value
      : { seconds: value._seconds, nanoseconds: value._nanoseconds };
  const milliseconds =
    parts.seconds * 1_000 + Math.floor(parts.nanoseconds / 1_000_000);
  if (!Number.isSafeInteger(milliseconds)) return null;
  const instant = new Date(milliseconds);
  return Number.isNaN(instant.getTime()) ? null : instant.toISOString();
}

function parseInstant(value: unknown): string | null {
  if (typeof value === "string") {
    const parsed = z.string().datetime({ offset: true }).safeParse(value);
    return parsed.success ? new Date(parsed.data).toISOString() : null;
  }
  const parsed = FirestoreTimestampSchema.safeParse(value);
  return parsed.success ? timestampToInstant(parsed.data) : null;
}

export function dateResolutionKey(
  collection: LegacySourceCollection,
  sourceId: string,
  field: string,
): string {
  return `${collection}\0${sourceId}\0${field}`;
}

export function resolveSalonDate(
  value: unknown,
  collection: "customers" | "vacations",
  sourceId: string,
  field: "selectedDate" | "startDate" | "endDate",
  context: TransformContext,
): string {
  if (typeof value === "string") {
    const datePart = value.slice(0, 10);
    const validShape =
      DATE_ONLY_PATTERN.test(value) ||
      z.string().datetime({ offset: true }).safeParse(value).success;
    if (!validShape || !isRealDate(datePart)) {
      throw new RecordQuarantine("INVALID_SALON_DATE", [fieldCode(field)]);
    }
    return datePart;
  }
  if (FirestoreTimestampSchema.safeParse(value).success) {
    const resolved = context.dateResolutions.get(
      dateResolutionKey(collection, sourceId, field),
    );
    if (!resolved) {
      throw new RecordQuarantine("UNRESOLVED_TIMESTAMP_DATE", [
        fieldCode(field),
      ]);
    }
    return resolved;
  }
  throw new RecordQuarantine("INVALID_SALON_DATE", [fieldCode(field)]);
}

function fieldCode(field: string): string {
  return field.replace(/([a-z])([A-Z])/g, "$1_$2").toUpperCase();
}

export function parseStartMinutes(value: string): number {
  const match = CLOCK_PATTERN.exec(value);
  const hour = Number(match?.[1]);
  const minute = Number(match?.[2]);
  if (!match || hour > 23 || minute > 59) {
    throw new RecordQuarantine("INVALID_START_TIME", ["START_TIME"]);
  }
  return hour * 60 + minute;
}

function trustedKey(
  collection: LegacySourceCollection,
  sourceId: string,
): string {
  return `${collection}\0${sourceId}`;
}

export function operationalTimestamps(
  collection: LegacySourceCollection,
  sourceId: string,
  importedAt: string,
  createdCandidate: unknown,
  updatedCandidate: unknown,
  context: TransformContext,
): {
  createdAt: string;
  updatedAt: string;
  timestampProvenance: "source" | "import_time";
} {
  if (context.trustedTimestamps.has(trustedKey(collection, sourceId))) {
    const createdAt = parseInstant(createdCandidate);
    const updatedAt = parseInstant(updatedCandidate);
    if (createdAt && updatedAt && updatedAt >= createdAt) {
      return { createdAt, updatedAt, timestampProvenance: "source" };
    }
  }
  return {
    createdAt: importedAt,
    updatedAt: importedAt,
    timestampProvenance: "import_time",
  };
}

export function normalizedNullable(value: string | undefined): string | null {
  if (value === undefined) return null;
  const normalized = value.trim();
  return normalized.length === 0 ? null : normalized;
}

export function cancellationInstant(
  status: string,
  candidate: unknown,
  timestamps: ReturnType<typeof operationalTimestamps>,
  importedAt: string,
): string | null {
  if (status !== "cancelled") return null;
  if (timestamps.timestampProvenance === "source") {
    const parsed = parseInstant(candidate);
    if (parsed && parsed >= timestamps.createdAt) return parsed;
  }
  return importedAt;
}

export function quarantine(
  collection: LegacySourceCollection,
  sourceId: string,
  data: unknown,
  error: unknown,
): LegacyQuarantineRecord {
  const classified =
    error instanceof RecordQuarantine
      ? error
      : new RecordQuarantine("INVALID_TARGET_RECORD", ["TARGET_RECORD"]);
  return {
    sourceCollection: collection,
    sourceRecordId: sourceId,
    sourceRecordSha256: sourceSha256(data),
    reasonCode: classified.reasonCode,
    fieldCodes: [...classified.fieldCodes].sort(),
  };
}

export function strictSourceData<T>(
  schema: z.ZodType<T>,
  data: unknown,
  fields: readonly string[],
): T {
  const parsed = schema.safeParse(data);
  if (!parsed.success) {
    throw new RecordQuarantine("INVALID_SOURCE_SHAPE", fields);
  }
  return parsed.data;
}

export function importedRecord<T extends { id: string }>(
  sourceCollection: LegacySourceCollection,
  document: LegacyDocument,
  targetKind: LegacyImportedRecord<T>["targetKind"],
  record: T,
): LegacyImportedRecord<T> {
  return {
    sourceCollection,
    sourceRecordId: document.id,
    sourceRecordSha256: sourceSha256(document.data),
    targetKind,
    targetId: record.id,
    record,
  };
}

export function contextFrom(
  importedAt: string,
  options: z.output<typeof LegacyFirestoreTransformOptionsSchema>,
): TransformContext {
  return {
    importedAt,
    dateResolutions: new Map(
      options.timestampDateResolutions.map((item) => [
        dateResolutionKey(item.collection, item.sourceId, item.field),
        item.salonDate,
      ]),
    ),
    blockDurations: new Map(
      options.blockDurationMappings.map((item) => [
        item.sourceId,
        {
          serviceDurationMinutes: item.serviceDurationMinutes,
          bufferMinutes: item.bufferMinutes,
        },
      ]),
    ),
    catalogMappings: options.catalogMappings as readonly z.output<
      typeof CatalogMappingSchema
    >[],
    trustedTimestamps: new Set(
      options.trustedTimestampRecords.map((item) =>
        trustedKey(item.collection, item.sourceId),
      ),
    ),
  };
}

export function compareSourceRecord(
  left: { sourceCollection: string; sourceRecordId: string },
  right: { sourceCollection: string; sourceRecordId: string },
): number {
  return (
    left.sourceCollection.localeCompare(right.sourceCollection) ||
    left.sourceRecordId.localeCompare(right.sourceRecordId)
  );
}

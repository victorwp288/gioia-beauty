import "server-only";

import { createHash } from "node:crypto";

import { z } from "zod";

import { ScheduleEntryPersistenceSchema } from "@/lib/domain/schemas/schedule.ts";
import { SubscriberPersistenceSchema } from "@/lib/domain/schemas/subscribers.ts";
import { VacationPersistenceSchema } from "@/lib/domain/schemas/vacations.ts";

import type { LegacyFirestoreTransformResult } from "./legacyFirestoreTransform.ts";

export const LEGACY_MIGRATION_IMPORT_MAX_BATCH = 100;
const LEGACY_SOURCE_MANIFEST_VERSION = "gioia:legacy-source-manifest:v1";

export interface LegacyMigrationImportInput {
  readonly runId: string;
  readonly sourceProjectRef: string;
  readonly sourceManifestSha256: string;
  readonly result: LegacyFirestoreTransformResult;
}

export interface LegacyMigrationImportSummary {
  readonly imported: number;
  readonly quarantined: number;
  readonly replayed: number;
  readonly source: number;
}

const Sha256HexSchema = z.string().regex(/^[0-9a-f]{64}$/u);
const SourceCollectionSchema = z.enum([
  "customers",
  "vacations",
  "newsletter_subscribers",
]);
const TargetKindSchema = z.enum(["schedule_entry", "vacation", "subscriber"]);
type SourceDispositionRecord = {
  readonly sourceCollection: string;
  readonly sourceRecordId: string;
  readonly sourceRecordSha256: string;
  readonly disposition: "imported" | "quarantined";
};

function sourceDispositionRecords(result: LegacyFirestoreTransformResult) {
  return [
    ...result.imported.map((record) => ({
      sourceCollection: record.sourceCollection,
      sourceRecordId: record.sourceRecordId,
      sourceRecordSha256: record.sourceRecordSha256,
      disposition: "imported" as const,
    })),
    ...result.quarantine.map((record) => ({
      sourceCollection: record.sourceCollection,
      sourceRecordId: record.sourceRecordId,
      sourceRecordSha256: record.sourceRecordSha256,
      disposition: "quarantined" as const,
    })),
  ];
}

function sourceDispositionTuple(record: SourceDispositionRecord): string {
  return JSON.stringify([
    record.sourceCollection,
    record.sourceRecordId,
    record.sourceRecordSha256,
    record.disposition,
  ]);
}

function compareCanonicalText(left: string, right: string): number {
  return left === right ? 0 : left < right ? -1 : 1;
}

export function legacySourceManifestSha256(
  result: LegacyFirestoreTransformResult,
): string {
  const canonicalManifest = sourceDispositionRecords(result)
    .sort(
      (left, right) =>
        compareCanonicalText(left.sourceCollection, right.sourceCollection) ||
        compareCanonicalText(left.sourceRecordId, right.sourceRecordId),
    )
    .map(sourceDispositionTuple)
    .join("\n");
  return createHash("sha256")
    .update(`${LEGACY_SOURCE_MANIFEST_VERSION}\n${canonicalManifest}`, "utf8")
    .digest("hex");
}

const ImportedRecordSchema = z
  .object({
    sourceCollection: SourceCollectionSchema,
    sourceRecordId: z.string().min(1).max(1_500),
    sourceRecordSha256: Sha256HexSchema,
    targetKind: TargetKindSchema,
    targetId: z.string().uuid(),
    record: z.unknown(),
  })
  .strict()
  .superRefine((value, context) => {
    const expectedCollection = {
      schedule_entry: "customers",
      subscriber: "newsletter_subscribers",
      vacation: "vacations",
    } as const;
    if (value.sourceCollection !== expectedCollection[value.targetKind]) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Target kind does not match the source collection",
        path: ["sourceCollection"],
      });
    }
    const schemas = {
      schedule_entry: ScheduleEntryPersistenceSchema,
      subscriber: SubscriberPersistenceSchema,
      vacation: VacationPersistenceSchema,
    } as const;
    const parsed = schemas[value.targetKind].safeParse(value.record);
    if (!parsed.success || parsed.data.id !== value.targetId) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Imported target record is invalid",
        path: ["record"],
      });
    }
  });
const QuarantineRecordSchema = z
  .object({
    sourceCollection: SourceCollectionSchema,
    sourceRecordId: z.string().min(1).max(1_500),
    sourceRecordSha256: Sha256HexSchema,
    reasonCode: z.string().regex(/^[A-Z][A-Z0-9_]{1,63}$/u),
    fieldCodes: z.array(z.string().regex(/^[A-Z][A-Z0-9_]{1,63}$/u)).max(50),
  })
  .strict();
const CountsSchema = z
  .object({
    source: z.number().int().min(1).max(LEGACY_MIGRATION_IMPORT_MAX_BATCH),
    imported: z.number().int().nonnegative(),
    quarantined: z.number().int().nonnegative(),
  })
  .strict()
  .refine(
    (counts) => counts.imported + counts.quarantined === counts.source,
    "Migration counts do not reconcile",
  );
const ApplyInputSchema = z
  .object({
    runId: z.string().uuid(),
    sourceProjectRef: z.string().min(6).max(255),
    sourceManifestSha256: Sha256HexSchema,
    result: z
      .object({
        imported: z
          .array(ImportedRecordSchema)
          .max(LEGACY_MIGRATION_IMPORT_MAX_BATCH),
        quarantine: z
          .array(QuarantineRecordSchema)
          .max(LEGACY_MIGRATION_IMPORT_MAX_BATCH),
        counts: CountsSchema,
      })
      .strict(),
  })
  .strict()
  .superRefine((input, context) => {
    if (
      input.result.imported.length !== input.result.counts.imported ||
      input.result.quarantine.length !== input.result.counts.quarantined
    ) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Migration result arrays do not reconcile with counts",
        path: ["result"],
      });
    }
    const keys = new Set<string>();
    for (const record of [
      ...input.result.imported,
      ...input.result.quarantine,
    ]) {
      const key = `${record.sourceCollection}\0${record.sourceRecordId}`;
      if (keys.has(key)) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          message: "Migration source records must be unique in a batch",
          path: ["result"],
        });
      }
      keys.add(key);
    }
    if (
      legacySourceManifestSha256(
        input.result as LegacyFirestoreTransformResult,
      ) !== input.sourceManifestSha256
    ) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Source manifest does not match migration dispositions",
        path: ["sourceManifestSha256"],
      });
    }
  });

export function parseLegacyMigrationImportInput(
  input: LegacyMigrationImportInput,
) {
  return ApplyInputSchema.parse(input);
}

export function legacyImportBytea(hex: string): Buffer {
  return Buffer.from(hex, "hex");
}

function canonicalJson(value: unknown): string {
  if (value === null) return "null";
  if (typeof value === "string" || typeof value === "boolean") {
    return JSON.stringify(value);
  }
  if (typeof value === "number" && Number.isFinite(value)) {
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return `[${value.map(canonicalJson).join(",")}]`;
  }
  if (typeof value !== "object") throw new TypeError("Non-JSON import value");
  const record = value as Record<string, unknown>;
  return `{${Object.keys(record)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${canonicalJson(record[key])}`)
    .join(",")}}`;
}

export function legacyTargetRecordSha256(record: unknown): Buffer {
  return createHash("sha256").update(canonicalJson(record), "utf8").digest();
}

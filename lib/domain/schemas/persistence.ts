import { z } from "zod";

import { IsoInstantSchema, UuidSchema } from "./primitives.ts";

export const SchemaVersionSchema = z.literal(1);
export const TimestampProvenanceSchema = z.enum(["source", "import_time"]);
export const LegacyFirestoreIdSchema = z.string().min(1).max(1500);

export const persistenceIdentityFields = {
  id: UuidSchema,
  schemaVersion: SchemaVersionSchema,
  legacyFirestoreId: LegacyFirestoreIdSchema.nullable(),
  timestampProvenance: TimestampProvenanceSchema,
  importedAt: IsoInstantSchema.nullable(),
  createdAt: IsoInstantSchema,
  updatedAt: IsoInstantSchema,
};

export function validateTimestampOrder(
  record: {
    createdAt: string;
    updatedAt: string;
  },
  context: z.RefinementCtx,
) {
  if (record.updatedAt < record.createdAt) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      message: "Updated timestamp cannot precede creation",
      path: ["updatedAt"],
    });
  }
}

export function validateImportProvenance(
  record: {
    source: string;
    legacyFirestoreId: string | null;
    importedAt: string | null;
  },
  context: z.RefinementCtx,
) {
  const isMigration = record.source === "migration";
  const hasImportIdentity =
    record.legacyFirestoreId !== null && record.importedAt !== null;

  if (isMigration !== hasImportIdentity) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      message: "Migration provenance must match the record source",
      path: ["source"],
    });
  }
}

export function validateInstantNotBefore(
  instant: string | null,
  lowerBound: string,
  path: string,
  context: z.RefinementCtx,
) {
  if (instant !== null && instant < lowerBound) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      message: `${path} cannot precede creation`,
      path: [path],
    });
  }
}

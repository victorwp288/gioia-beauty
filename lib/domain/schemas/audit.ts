import { z } from "zod";

import { SchemaVersionSchema } from "./persistence.ts";
import {
  ErrorCodeSchema,
  IsoInstantSchema,
  PositiveVersionSchema,
  UuidSchema,
} from "./primitives.ts";

const ChangedFieldSchema = z.string().regex(/^[a-z][a-z0-9_]{0,62}$/);

export const DomainChangeLogPersistenceSchema = z
  .object({
    sequenceId: z.bigint().positive(),
    aggregateKind: z.enum(["schedule_entry", "vacation", "subscriber"]),
    aggregateId: UuidSchema,
    aggregateVersion: PositiveVersionSchema,
    changeKind: z.enum([
      "create",
      "update",
      "reschedule",
      "cancel",
      "block",
      "subscribe",
      "unsubscribe",
    ]),
    schemaVersion: SchemaVersionSchema,
    source: z.enum(["public", "admin", "migration", "system"]),
    commandRequestId: UuidSchema.nullable(),
    migrationRunId: UuidSchema.nullable(),
    actorUserId: UuidSchema.nullable(),
    changedFields: z.array(ChangedFieldSchema).min(1).max(32),
    changedAt: IsoInstantSchema,
  })
  .strict()
  .superRefine((event, context) => {
    if (new Set(event.changedFields).size !== event.changedFields.length) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Changed-field names must be unique",
        path: ["changedFields"],
      });
    }
    const validSourceShape =
      (event.source === "public" &&
        event.commandRequestId !== null &&
        event.migrationRunId === null &&
        event.actorUserId === null) ||
      (event.source === "admin" &&
        event.commandRequestId !== null &&
        event.migrationRunId === null) ||
      (event.source === "migration" &&
        event.commandRequestId === null &&
        event.migrationRunId !== null &&
        event.actorUserId === null) ||
      (event.source === "system" &&
        event.migrationRunId === null &&
        event.actorUserId === null);
    if (!validSourceShape) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Audit identity must match the event source",
        path: ["source"],
      });
    }
  });

export const PiiSafeOperationalLogSchema = z
  .object({
    eventCode: ErrorCodeSchema,
    requestId: UuidSchema,
    resourceKind: z
      .enum(["schedule_entry", "vacation", "subscriber", "outbox"])
      .nullable(),
    resourceId: UuidSchema.nullable(),
    errorCode: ErrorCodeSchema.nullable(),
  })
  .strict()
  .superRefine((event, context) => {
    if ((event.resourceKind === null) !== (event.resourceId === null)) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Resource identifiers must be paired",
        path: ["resourceId"],
      });
    }
  });

export type DomainChangeLogPersistence = z.infer<
  typeof DomainChangeLogPersistenceSchema
>;
export type PiiSafeOperationalLog = z.infer<typeof PiiSafeOperationalLogSchema>;

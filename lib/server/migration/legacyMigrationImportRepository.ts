import "server-only";

import {
  ScheduleEntryPersistenceSchema,
  type ScheduleEntryPersistence,
} from "@/lib/domain/schemas/schedule.ts";
import {
  SubscriberPersistenceSchema,
  type SubscriberPersistence,
} from "@/lib/domain/schemas/subscribers.ts";
import {
  VacationPersistenceSchema,
  type VacationPersistence,
} from "@/lib/domain/schemas/vacations.ts";

import type { LegacyImportedRecord } from "./legacyFirestoreTransform.ts";
import {
  legacyImportBytea,
  legacyTargetRecordSha256,
  parseLegacyMigrationImportInput,
  type LegacyMigrationImportInput,
  type LegacyMigrationImportSummary,
} from "./legacyMigrationImportSupport.ts";

export {
  LEGACY_MIGRATION_IMPORT_MAX_BATCH,
  legacySourceManifestSha256,
  legacyTargetRecordSha256,
} from "./legacyMigrationImportSupport.ts";
export type {
  LegacyMigrationImportInput,
  LegacyMigrationImportSummary,
} from "./legacyMigrationImportSupport.ts";

interface ImportTransaction {
  unsafe(query: string, parameters?: readonly unknown[]): Promise<unknown[]>;
}

export interface LegacyMigrationImportDatabase {
  transaction<T>(
    callback: (transaction: ImportTransaction) => Promise<T>,
  ): Promise<T>;
}

function requiredBooleanRow(rows: unknown[], label: string): boolean {
  if (
    rows.length !== 1 ||
    !rows[0] ||
    typeof rows[0] !== "object" ||
    typeof (rows[0] as { inserted?: unknown }).inserted !== "boolean"
  ) {
    throw new Error(`Unexpected ${label} result`);
  }
  return (rows[0] as { inserted: boolean }).inserted;
}

async function importSchedule(
  transaction: ImportTransaction,
  runId: string,
  imported: LegacyImportedRecord<ScheduleEntryPersistence>,
): Promise<boolean> {
  const record = ScheduleEntryPersistenceSchema.parse(imported.record);
  const appointment = record.kind === "appointment" ? record : null;
  const rows = await transaction.unsafe(
    `select gioia_private.apply_legacy_schedule_import(
       $1::uuid,$2::text,$3::bytea,$4::bytea,$5::uuid,$6::text,
       $7::text,$8::text,$9::date,$10::smallint,$11::smallint,$12::smallint,
       $13::text,$14::text,$15::text,$16::text,$17::integer,$18::text,
       $19::text,$20::text,$21::text,$22::text,$23::text,$24::text,
       $25::timestamptz,$26::text,$27::text,$28::timestamptz,
       $29::timestamptz,$30::timestamptz,$31::integer
     ) as inserted`,
    [
      runId,
      imported.sourceRecordId,
      legacyImportBytea(imported.sourceRecordSha256),
      legacyTargetRecordSha256(record),
      record.id,
      record.legacyFirestoreId,
      record.kind,
      record.status,
      record.date,
      record.startMinutes,
      record.serviceDurationMinutes,
      record.bufferMinutes,
      appointment?.serviceId ?? null,
      appointment?.variantId ?? null,
      appointment?.serviceNameSnapshot ?? null,
      appointment?.variantNameSnapshot ?? null,
      appointment?.priceCentsSnapshot ?? null,
      appointment?.currencySnapshot ?? null,
      appointment?.clientName ?? null,
      appointment?.clientEmail ?? null,
      appointment?.clientPhone ?? null,
      appointment?.clientNote ?? null,
      record.internalNote ?? null,
      record.cancelledBy ?? null,
      record.cancelledAt,
      record.cancellationReason ?? null,
      record.timestampProvenance,
      record.importedAt,
      record.createdAt,
      record.updatedAt,
      record.version,
    ],
  );
  return requiredBooleanRow(rows, "schedule import");
}

async function importVacation(
  transaction: ImportTransaction,
  runId: string,
  imported: LegacyImportedRecord<VacationPersistence>,
): Promise<boolean> {
  const record = VacationPersistenceSchema.parse(imported.record);
  const rows = await transaction.unsafe(
    `select gioia_private.apply_legacy_vacation_import(
       $1::uuid,$2::text,$3::bytea,$4::bytea,$5::uuid,$6::text,
       $7::date,$8::date,$9::text,$10::text,$11::timestamptz,$12::text,
       $13::timestamptz,$14::timestamptz,$15::timestamptz,$16::integer
     ) as inserted`,
    [
      runId,
      imported.sourceRecordId,
      legacyImportBytea(imported.sourceRecordSha256),
      legacyTargetRecordSha256(record),
      record.id,
      record.legacyFirestoreId,
      record.startDate,
      record.endDate,
      record.status,
      record.reason,
      record.cancelledAt,
      record.timestampProvenance,
      record.importedAt,
      record.createdAt,
      record.updatedAt,
      record.version,
    ],
  );
  return requiredBooleanRow(rows, "vacation import");
}

async function importSubscriber(
  transaction: ImportTransaction,
  runId: string,
  imported: LegacyImportedRecord<SubscriberPersistence>,
): Promise<boolean> {
  const record = SubscriberPersistenceSchema.parse(imported.record);
  const rows = await transaction.unsafe(
    `select gioia_private.apply_legacy_subscriber_import(
       $1::uuid,$2::text,$3::bytea,$4::bytea,$5::uuid,$6::text,
       $7::text,$8::text,$9::timestamptz,$10::text,$11::text,
       $12::timestamptz,$13::timestamptz,$14::text,$15::timestamptz,
       $16::timestamptz,$17::timestamptz,$18::integer
     ) as inserted`,
    [
      runId,
      imported.sourceRecordId,
      legacyImportBytea(imported.sourceRecordSha256),
      legacyTargetRecordSha256(record),
      record.id,
      record.legacyFirestoreId,
      record.email,
      record.status,
      record.consentAt,
      record.consentSource,
      record.consentPolicyVersion,
      record.confirmedAt,
      record.unsubscribedAt,
      record.timestampProvenance,
      record.importedAt,
      record.createdAt,
      record.updatedAt,
      record.version,
    ],
  );
  return requiredBooleanRow(rows, "subscriber import");
}

async function importRecord(
  transaction: ImportTransaction,
  runId: string,
  imported: LegacyImportedRecord<
    ScheduleEntryPersistence | VacationPersistence | SubscriberPersistence
  >,
): Promise<boolean> {
  if (imported.targetKind === "schedule_entry") {
    return importSchedule(
      transaction,
      runId,
      imported as LegacyImportedRecord<ScheduleEntryPersistence>,
    );
  }
  if (imported.targetKind === "vacation") {
    return importVacation(
      transaction,
      runId,
      imported as LegacyImportedRecord<VacationPersistence>,
    );
  }
  return importSubscriber(
    transaction,
    runId,
    imported as LegacyImportedRecord<SubscriberPersistence>,
  );
}

export async function applyLegacyMigrationImport(
  database: LegacyMigrationImportDatabase,
  rawInput: LegacyMigrationImportInput,
): Promise<LegacyMigrationImportSummary> {
  const input = parseLegacyMigrationImportInput(rawInput);
  return database.transaction(async (transaction) => {
    await transaction.unsafe("set local lock_timeout = '5s'");
    await transaction.unsafe("set local statement_timeout = '30s'");
    await transaction.unsafe(
      "set local idle_in_transaction_session_timeout = '30s'",
    );
    await transaction.unsafe("set local role gioia_migrator");
    await transaction.unsafe(
      `select gioia_private.begin_legacy_migration_import(
         $1::uuid,$2::text,$3::bytea,$4::smallint
       ) as started`,
      [
        input.runId,
        input.sourceProjectRef,
        legacyImportBytea(input.sourceManifestSha256),
        input.result.counts.source,
      ],
    );
    let inserted = 0;
    const importedRecords = input.result.imported as unknown as ReadonlyArray<
      LegacyImportedRecord<
        ScheduleEntryPersistence | VacationPersistence | SubscriberPersistence
      >
    >;
    for (const record of importedRecords) {
      if (await importRecord(transaction, input.runId, record)) inserted += 1;
    }
    for (const record of input.result.quarantine) {
      const rows = await transaction.unsafe(
        `select gioia_private.apply_legacy_quarantine_import(
           $1::uuid,$2::text,$3::text,$4::bytea,$5::text,$6::text[]
         ) as inserted`,
        [
          input.runId,
          record.sourceCollection,
          record.sourceRecordId,
          legacyImportBytea(record.sourceRecordSha256),
          record.reasonCode,
          record.fieldCodes,
        ],
      );
      if (requiredBooleanRow(rows, "quarantine import")) inserted += 1;
    }
    const completeRows = await transaction.unsafe(
      `select source_count, imported_count, quarantined_count
       from gioia_private.complete_legacy_migration_import($1::uuid)`,
      [input.runId],
    );
    const complete = completeRows[0] as
      | {
          source_count?: unknown;
          imported_count?: unknown;
          quarantined_count?: unknown;
        }
      | undefined;
    if (
      completeRows.length !== 1 ||
      typeof complete?.source_count !== "number" ||
      typeof complete.imported_count !== "number" ||
      typeof complete.quarantined_count !== "number"
    ) {
      throw new Error("Unexpected migration completion result");
    }
    return Object.freeze({
      source: complete.source_count,
      imported: complete.imported_count,
      quarantined: complete.quarantined_count,
      replayed: input.result.counts.source - inserted,
    });
  });
}

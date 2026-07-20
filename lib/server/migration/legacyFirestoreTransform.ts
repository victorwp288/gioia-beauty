import "server-only";

import type { ScheduleEntryPersistence } from "@/lib/domain/schemas/schedule.ts";
import type { SubscriberPersistence } from "@/lib/domain/schemas/subscribers.ts";
import type { VacationPersistence } from "@/lib/domain/schemas/vacations.ts";
import { transformCustomer } from "./legacyFirestoreCustomerTransform.ts";
import {
  transformSubscriber,
  transformVacation,
} from "./legacyFirestoreSupplementalTransform.ts";
import {
  LegacyFirestoreBatchSchema,
  LegacyFirestoreTransformOptionsSchema,
  type LegacyDocument,
  type LegacyFirestoreBatch,
  type LegacyFirestoreTransformOptions,
  type LegacyFirestoreTransformResult,
  type LegacyImportedRecord,
  type LegacyQuarantineRecord,
  type LegacySourceCollection,
  type TransformContext,
} from "./legacyFirestoreTransformContract.ts";
import {
  compareSourceRecord,
  contextFrom,
  quarantine,
} from "./legacyFirestoreTransformHelpers.ts";

export {
  LegacyFirestoreBatchSchema,
  LegacyFirestoreTransformOptionsSchema,
} from "./legacyFirestoreTransformContract.ts";
export type {
  LegacyFirestoreBatch,
  LegacyFirestoreTransformOptions,
  LegacyFirestoreTransformResult,
  LegacyImportedRecord,
  LegacyQuarantineReasonCode,
  LegacyQuarantineRecord,
  LegacySourceCollection,
} from "./legacyFirestoreTransformContract.ts";

type PersistenceRecord =
  ScheduleEntryPersistence | VacationPersistence | SubscriberPersistence;

function duplicateSubscriberIds(
  imported: readonly LegacyImportedRecord<PersistenceRecord>[],
): ReadonlySet<string> {
  const byEmail = new Map<string, string[]>();
  for (const item of imported) {
    if (item.targetKind !== "subscriber") continue;
    const subscriber = item.record as SubscriberPersistence;
    const ids = byEmail.get(subscriber.email) ?? [];
    ids.push(item.sourceRecordId);
    byEmail.set(subscriber.email, ids);
  }
  const duplicates = new Set<string>();
  for (const ids of byEmail.values()) {
    if (ids.length > 1) ids.forEach((id) => duplicates.add(id));
  }
  return duplicates;
}

function quarantineSubscriberDuplicates(
  imported: LegacyImportedRecord<PersistenceRecord>[],
  quarantined: LegacyQuarantineRecord[],
): void {
  const duplicateIds = duplicateSubscriberIds(imported);
  if (duplicateIds.size === 0) return;
  const retained = imported.filter(
    (item) =>
      item.sourceCollection !== "newsletter_subscribers" ||
      !duplicateIds.has(item.sourceRecordId),
  );
  imported
    .filter(
      (item) =>
        item.sourceCollection === "newsletter_subscribers" &&
        duplicateIds.has(item.sourceRecordId),
    )
    .forEach((item) => {
      quarantined.push({
        sourceCollection: "newsletter_subscribers",
        sourceRecordId: item.sourceRecordId,
        sourceRecordSha256: item.sourceRecordSha256,
        reasonCode: "DUPLICATE_NORMALIZED_EMAIL",
        fieldCodes: ["EMAIL"],
      });
    });
  imported.length = 0;
  imported.push(...retained);
}

export function transformLegacyFirestoreBatch(
  input: LegacyFirestoreBatch,
  rawOptions: LegacyFirestoreTransformOptions = {},
): LegacyFirestoreTransformResult {
  const batch = LegacyFirestoreBatchSchema.parse(input);
  const options = LegacyFirestoreTransformOptionsSchema.parse(rawOptions);
  const context = contextFrom(
    new Date(batch.importedAt).toISOString(),
    options,
  );
  const imported: LegacyImportedRecord<PersistenceRecord>[] = [];
  const quarantined: LegacyQuarantineRecord[] = [];

  const process = <T extends PersistenceRecord>(
    collection: LegacySourceCollection,
    documents: readonly LegacyDocument[],
    transform: (
      document: LegacyDocument,
      transformContext: TransformContext,
    ) => LegacyImportedRecord<T>,
  ): void => {
    for (const document of [...documents].sort((left, right) =>
      left.id.localeCompare(right.id),
    )) {
      try {
        imported.push(transform(document, context));
      } catch (error) {
        quarantined.push(
          quarantine(collection, document.id, document.data, error),
        );
      }
    }
  };

  process("customers", batch.customers, transformCustomer);
  process("vacations", batch.vacations, transformVacation);
  process(
    "newsletter_subscribers",
    batch.newsletterSubscribers,
    transformSubscriber,
  );
  quarantineSubscriberDuplicates(imported, quarantined);

  imported.sort(compareSourceRecord);
  quarantined.sort(compareSourceRecord);
  const source =
    batch.customers.length +
    batch.vacations.length +
    batch.newsletterSubscribers.length;
  return Object.freeze({
    imported: Object.freeze(imported),
    quarantine: Object.freeze(quarantined),
    counts: Object.freeze({
      source,
      imported: imported.length,
      quarantined: quarantined.length,
    }),
  });
}

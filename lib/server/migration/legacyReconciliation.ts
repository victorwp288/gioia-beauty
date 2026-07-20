import "server-only";

import {
  ENTITIES,
  STATUSES,
  assertCode,
  assertDuplicateFinding,
  assertInputBounds,
  assertSemantic,
  fail,
  isSafeId,
  isSha256,
  LegacyReconciliationInputError,
  LEGACY_RECONCILIATION_MAX_RECORDS,
  type LegacyDuplicateKind,
  type LegacyEntityKind,
  type LegacyImportedRecord,
  type LegacyReconciliationInput,
  type LegacySemanticSnapshot,
  type LegacySourceCollection,
  type LegacySourceLedgerRecord,
  type LegacyStatus,
  type LegacyTransformedRecord,
  type LegacyQuarantineRecord,
} from "./legacyReconciliationContracts.ts";
import {
  increment,
  keyOf,
  manifestHash,
  semanticMismatches,
  sha256,
  sortedObject,
  uniqueMap,
} from "./legacyReconciliationSupport.ts";

export { LegacyReconciliationInputError, LEGACY_RECONCILIATION_MAX_RECORDS };
export type {
  LegacyDuplicateKind,
  LegacyEntityKind,
  LegacyImportedRecord,
  LegacyQuarantineRecord,
  LegacyReconciliationInput,
  LegacySemanticSnapshot,
  LegacySourceCollection,
  LegacySourceLedgerRecord,
  LegacyStatus,
  LegacyTransformedRecord,
};

export function reconcileLegacyMigration(input: LegacyReconciliationInput) {
  assertInputBounds(input);
  const source = uniqueMap(input.source, "DUPLICATE_SOURCE_ID");
  const transformed = uniqueMap(input.transformed, "DUPLICATE_TRANSFORM_ID");
  const imported = uniqueMap(input.imported, "DUPLICATE_IMPORT_ID");
  const quarantine = uniqueMap(input.quarantine, "DUPLICATE_QUARANTINE_ID");
  const targetIds = new Set<string>();
  const byCollection = new Map<string, number>();
  const byEntity = new Map<string, number>();
  const byStatus = new Map<string, number>();
  const byQuarantineReason = new Map<string, number>();
  const issueCounts = new Map<string, number>();
  let sourceFutureConfirmed = 0;
  let importedFutureConfirmed = 0;
  let reviewedQuarantine = 0;

  for (const record of input.source) {
    if (!isSha256(record.sourceRecordSha256)) fail("INVALID_SOURCE_HASH");
    if (
      !ENTITIES.includes(record.entityKind) ||
      !STATUSES.includes(record.sourceStatus)
    )
      fail("INVALID_SOURCE_CLASSIFICATION");
    if (record.expected) {
      assertSemantic(record.expected);
      if (record.expected.entityKind !== record.entityKind)
        fail("SOURCE_ENTITY_MISMATCH");
      if (record.expected.futureConfirmed) sourceFutureConfirmed += 1;
    }
    increment(byCollection, record.sourceCollection);
    increment(byEntity, record.entityKind);
    increment(byStatus, record.sourceStatus);
  }
  for (const record of input.transformed) {
    if (!isSha256(record.sourceRecordSha256)) fail("INVALID_SOURCE_HASH");
    if (!isSha256(record.targetRecordSha256)) fail("INVALID_TARGET_HASH");
    assertSemantic(record.semantic);
  }
  for (const record of input.imported) {
    if (!isSha256(record.sourceRecordSha256)) fail("INVALID_SOURCE_HASH");
    if (!isSha256(record.targetRecordSha256)) fail("INVALID_TARGET_HASH");
    if (!isSafeId(record.targetId)) fail("INVALID_TARGET_ID");
    if (targetIds.has(record.targetId)) fail("DUPLICATE_TARGET_ID");
    targetIds.add(record.targetId);
    assertSemantic(record.semantic);
    if (record.semantic.futureConfirmed) importedFutureConfirmed += 1;
  }
  for (const record of input.quarantine) {
    if (!isSha256(record.sourceRecordSha256)) fail("INVALID_SOURCE_HASH");
    assertCode(record.reasonCode);
    if (!Array.isArray(record.fieldCodes) || record.fieldCodes.length > 50)
      fail("INVALID_FIELD_CODES");
    record.fieldCodes.forEach(assertCode);
    if (typeof record.reviewed !== "boolean") fail("INVALID_REVIEW_STATE");
    increment(byQuarantineReason, record.reasonCode);
    if (record.reviewed) reviewedQuarantine += 1;
    else increment(issueCounts, "UNREVIEWED_QUARANTINE");
  }

  for (const [key, sourceRecord] of source) {
    const transformedRecord = transformed.get(key);
    const importedRecord = imported.get(key);
    const quarantineRecord = quarantine.get(key);
    if (
      transformedRecord &&
      transformedRecord.sourceRecordSha256 !== sourceRecord.sourceRecordSha256
    )
      increment(issueCounts, "TRANSFORM_SOURCE_CHECKSUM_MISMATCH");
    if (
      importedRecord &&
      importedRecord.sourceRecordSha256 !== sourceRecord.sourceRecordSha256
    )
      increment(issueCounts, "IMPORT_SOURCE_CHECKSUM_MISMATCH");
    if (
      quarantineRecord &&
      quarantineRecord.sourceRecordSha256 !== sourceRecord.sourceRecordSha256
    )
      increment(issueCounts, "QUARANTINE_SOURCE_CHECKSUM_MISMATCH");
    if (Boolean(importedRecord) === Boolean(quarantineRecord)) {
      increment(issueCounts, "SOURCE_DISPOSITION_MISMATCH");
      continue;
    }
    if (quarantineRecord) {
      if (transformedRecord)
        increment(issueCounts, "QUARANTINED_RECORD_TRANSFORMED");
      continue;
    }
    if (!sourceRecord.expected || !transformedRecord || !importedRecord) {
      increment(issueCounts, "IMPORT_LEDGER_INCOMPLETE");
      continue;
    }
    semanticMismatches(
      sourceRecord.expected,
      transformedRecord.semantic,
    ).forEach((code) => increment(issueCounts, `TRANSFORM_${code}`));
    semanticMismatches(sourceRecord.expected, importedRecord.semantic).forEach(
      (code) => increment(issueCounts, code),
    );
    if (
      transformedRecord.targetRecordSha256 !== importedRecord.targetRecordSha256
    )
      increment(issueCounts, "TARGET_CHECKSUM_MISMATCH");
  }
  for (const key of new Set([
    ...transformed.keys(),
    ...imported.keys(),
    ...quarantine.keys(),
  ])) {
    if (!source.has(key)) increment(issueCounts, "ORPHAN_DISPOSITION");
  }

  const duplicates = input.duplicates ?? [];
  if (!Array.isArray(duplicates) || duplicates.length > input.maxRecords)
    fail("BOUND_EXCEEDED");
  const duplicateGroups = new Set<string>();
  let reviewedSourceDuplicates = 0;
  let unresolvedSourceDuplicates = 0;
  let targetDuplicates = 0;
  for (const finding of duplicates) {
    assertDuplicateFinding(finding, input.maxRecords);
    const duplicateKey = `${finding.scope}\u0000${finding.kind}\u0000${finding.groupSha256}`;
    if (duplicateGroups.has(duplicateKey)) fail("DUPLICATE_FINDING");
    duplicateGroups.add(duplicateKey);
    if (finding.scope === "target") {
      targetDuplicates += 1;
      increment(issueCounts, "TARGET_DUPLICATE");
    } else if (finding.reviewed) reviewedSourceDuplicates += 1;
    else {
      unresolvedSourceDuplicates += 1;
      increment(issueCounts, "UNRESOLVED_SOURCE_DUPLICATE");
    }
  }
  if (sourceFutureConfirmed !== importedFutureConfirmed)
    increment(issueCounts, "FUTURE_CONFIRMED_COUNT_MISMATCH");

  const stopConditions = [...issueCounts]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([code, count]) => Object.freeze({ code, count }));
  const checksums = Object.freeze({
    sourceManifestSha256: manifestHash(
      input.source,
      (record) => record.sourceRecordSha256,
    ),
    transformedManifestSha256: manifestHash(
      input.transformed,
      (record) =>
        `${record.sourceRecordSha256}\u0000${record.targetRecordSha256}`,
    ),
    importedManifestSha256: manifestHash(
      input.imported,
      (record) =>
        `${record.sourceRecordSha256}\u0000${record.targetRecordSha256}`,
    ),
    quarantineManifestSha256: manifestHash(
      input.quarantine,
      (record) =>
        `${record.sourceRecordSha256}\u0000${record.reasonCode}\u0000${[...record.fieldCodes].sort().join(",")}\u0000${record.reviewed}`,
    ),
  });
  const counts = Object.freeze({
    source: input.source.length,
    transformed: input.transformed.length,
    imported: input.imported.length,
    quarantined: input.quarantine.length,
    reviewedQuarantine,
    unresolvedQuarantine: input.quarantine.length - reviewedQuarantine,
    sourceFutureConfirmed,
    importedFutureConfirmed,
    reviewedSourceDuplicateGroups: reviewedSourceDuplicates,
    unresolvedSourceDuplicateGroups: unresolvedSourceDuplicates,
    targetDuplicateGroups: targetDuplicates,
    byCollection: sortedObject(byCollection),
    byEntity: sortedObject(byEntity),
    byStatus: sortedObject(byStatus),
    byQuarantineReason: sortedObject(byQuarantineReason),
  });
  const reportBase = {
    contractVersion: 1,
    ok: stopConditions.length === 0,
    counts,
    stopConditions: Object.freeze(stopConditions),
    checksums,
  };
  return Object.freeze({
    ...reportBase,
    reportSha256: sha256(JSON.stringify(reportBase)),
  });
}

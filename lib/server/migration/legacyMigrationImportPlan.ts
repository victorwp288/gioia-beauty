import "server-only";

import { createHash } from "node:crypto";

import type { LegacyFirestoreTransformResult } from "./legacyFirestoreTransform.ts";
import {
  LEGACY_MIGRATION_IMPORT_MAX_BATCH,
  legacySourceManifestSha256,
  parseLegacyMigrationImportInput,
  type LegacyMigrationImportInput,
  type LegacyMigrationImportSummary,
} from "./legacyMigrationImportSupport.ts";

const PLAN_NAMESPACE = "gioia:legacy-migration-import-plan:v1";

type Disposition =
  | LegacyFirestoreTransformResult["imported"][number]
  | LegacyFirestoreTransformResult["quarantine"][number];

export interface LegacyMigrationImportBatchPlan {
  readonly index: number;
  readonly input: LegacyMigrationImportInput;
}

export interface LegacyMigrationImportPlan {
  readonly globalSourceManifestSha256: string;
  readonly sourceProjectRef: string;
  readonly counts: LegacyFirestoreTransformResult["counts"];
  readonly batches: readonly LegacyMigrationImportBatchPlan[];
}

export interface LegacyMigrationImportResume {
  readonly globalSourceManifestSha256: string;
  /** Informational only: restart always replays every batch through the DB ledger. */
  readonly completedRunIds: readonly string[];
}

export interface LegacyMigrationImportPlanSummary {
  readonly counts: LegacyFirestoreTransformResult["counts"];
  readonly batches: {
    readonly total: number;
    readonly applied: number;
  };
  readonly results: readonly {
    readonly index: number;
    readonly runId: string;
    readonly summary: LegacyMigrationImportSummary;
  }[];
  readonly resume: LegacyMigrationImportResume;
}

export type ApplyLegacyMigrationImportBatch = (
  input: LegacyMigrationImportInput,
) => Promise<LegacyMigrationImportSummary>;

function dispositionKey(disposition: Disposition): string {
  return `${disposition.sourceCollection}\0${disposition.sourceRecordId}`;
}

function compareText(left: string, right: string): number {
  return left === right ? 0 : left < right ? -1 : 1;
}

function compareDisposition(left: Disposition, right: Disposition): number {
  return (
    compareText(left.sourceCollection, right.sourceCollection) ||
    compareText(left.sourceRecordId, right.sourceRecordId)
  );
}

function deterministicRunId(
  sourceProjectRef: string,
  globalManifest: string,
  batchIndex: number,
  batchManifest: string,
): string {
  const bytes = createHash("sha256")
    .update(
      `${PLAN_NAMESPACE}\0${sourceProjectRef}\0${globalManifest}\0${batchIndex}\0${batchManifest}`,
      "utf8",
    )
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

function batchResult(dispositions: readonly Disposition[]) {
  const imported = dispositions.filter(
    (record): record is LegacyFirestoreTransformResult["imported"][number] =>
      "targetKind" in record,
  );
  const quarantine = dispositions.filter(
    (record): record is LegacyFirestoreTransformResult["quarantine"][number] =>
      "reasonCode" in record,
  );
  return Object.freeze({
    imported: Object.freeze(imported),
    quarantine: Object.freeze(quarantine),
    counts: Object.freeze({
      source: dispositions.length,
      imported: imported.length,
      quarantined: quarantine.length,
    }),
  });
}

function validatedDispositions(
  result: LegacyFirestoreTransformResult,
): readonly Disposition[] {
  const dispositions = [...result.imported, ...result.quarantine].sort(
    compareDisposition,
  );
  if (
    result.counts.source < 1 ||
    result.counts.imported !== result.imported.length ||
    result.counts.quarantined !== result.quarantine.length ||
    result.counts.source !== dispositions.length
  ) {
    throw new Error("Global migration result counts do not reconcile");
  }
  const sourceKeys = new Set<string>();
  for (const disposition of dispositions) {
    const key = dispositionKey(disposition);
    if (sourceKeys.has(key)) {
      throw new Error("Global migration source records must be unique");
    }
    sourceKeys.add(key);
  }
  return dispositions;
}

export function createLegacyMigrationImportPlan(
  sourceProjectRef: string,
  result: LegacyFirestoreTransformResult,
): LegacyMigrationImportPlan {
  const dispositions = validatedDispositions(result);
  const globalManifest = legacySourceManifestSha256(result);
  const batches: LegacyMigrationImportBatchPlan[] = [];
  for (
    let offset = 0;
    offset < dispositions.length;
    offset += LEGACY_MIGRATION_IMPORT_MAX_BATCH
  ) {
    const index = batches.length;
    const batch = batchResult(
      dispositions.slice(offset, offset + LEGACY_MIGRATION_IMPORT_MAX_BATCH),
    );
    const batchManifest = legacySourceManifestSha256(batch);
    const input: LegacyMigrationImportInput = {
      runId: deterministicRunId(
        sourceProjectRef,
        globalManifest,
        index,
        batchManifest,
      ),
      sourceProjectRef,
      sourceManifestSha256: batchManifest,
      result: batch,
    };
    parseLegacyMigrationImportInput(input);
    batches.push(Object.freeze({ index, input: Object.freeze(input) }));
  }
  return Object.freeze({
    globalSourceManifestSha256: globalManifest,
    sourceProjectRef,
    counts: Object.freeze({ ...result.counts }),
    batches: Object.freeze(batches),
  });
}

function validateResume(
  plan: LegacyMigrationImportPlan,
  resume?: LegacyMigrationImportResume,
): void {
  if (!resume) return;
  if (resume.globalSourceManifestSha256 !== plan.globalSourceManifestSha256) {
    throw new Error("Migration resume manifest does not match the plan");
  }
  const planned = new Set(plan.batches.map((batch) => batch.input.runId));
  for (const runId of resume.completedRunIds) {
    if (!planned.has(runId)) {
      throw new Error("Migration resume contains an unknown batch run ID");
    }
  }
}

export async function executeLegacyMigrationImportPlan(
  plan: LegacyMigrationImportPlan,
  applyBatch: ApplyLegacyMigrationImportBatch,
  resume?: LegacyMigrationImportResume,
): Promise<LegacyMigrationImportPlanSummary> {
  validateResume(plan, resume);
  const completed = new Set<string>();
  const results: LegacyMigrationImportPlanSummary["results"][number][] = [];
  for (const batch of plan.batches) {
    const runId = batch.input.runId;
    const summary = await applyBatch(batch.input);
    const expected = batch.input.result.counts;
    if (
      summary.source !== expected.source ||
      summary.imported !== expected.imported ||
      summary.quarantined !== expected.quarantined ||
      summary.replayed < 0 ||
      summary.replayed > expected.source
    ) {
      throw new Error("Migration batch summary does not reconcile with plan");
    }
    completed.add(runId);
    results.push({ index: batch.index, runId, summary });
  }
  return Object.freeze({
    counts: plan.counts,
    batches: Object.freeze({
      total: plan.batches.length,
      applied: results.length,
    }),
    results: Object.freeze(results),
    resume: Object.freeze({
      globalSourceManifestSha256: plan.globalSourceManifestSha256,
      completedRunIds: Object.freeze(
        plan.batches
          .map((batch) => batch.input.runId)
          .filter((runId) => completed.has(runId)),
      ),
    }),
  });
}

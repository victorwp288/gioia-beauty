import { createHash } from "node:crypto";

import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import type { LegacyFirestoreTransformResult } from "@/lib/server/migration/legacyFirestoreTransform.ts";
import {
  createLegacyMigrationImportPlan,
  executeLegacyMigrationImportPlan,
} from "@/lib/server/migration/legacyMigrationImportPlan.ts";
import { legacySourceManifestSha256 } from "@/lib/server/migration/legacyMigrationImportSupport.ts";

const INSTANT = "2026-07-20T10:00:00.000Z";
const TARGET_ID = "a6000000-0000-4000-8000-000000000002";

function sha(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function migrationResult(
  sourceCount = 250,
  reverse = false,
): LegacyFirestoreTransformResult {
  const quarantine = Array.from({ length: sourceCount - 1 }, (_, index) => ({
    sourceCollection: "customers" as const,
    sourceRecordId: `legacy-invalid-${String(index).padStart(4, "0")}`,
    sourceRecordSha256: sha(`source-${index}`),
    reasonCode: "INVALID_SOURCE_SHAPE" as const,
    fieldCodes: ["CUSTOMER_DOCUMENT"],
  }));
  const imported: LegacyFirestoreTransformResult["imported"] = [
    {
      sourceCollection: "newsletter_subscribers",
      sourceRecordId: "legacy-subscriber-1",
      sourceRecordSha256: sha("subscriber-1"),
      targetKind: "subscriber",
      targetId: TARGET_ID,
      record: {
        id: TARGET_ID,
        schemaVersion: 1,
        legacyFirestoreId: "legacy-subscriber-1",
        timestampProvenance: "import_time",
        importedAt: INSTANT,
        createdAt: INSTANT,
        updatedAt: INSTANT,
        email: "synthetic-import@gioia.test",
        status: "legacy_unverified",
        source: "migration",
        consentAt: null,
        consentSource: null,
        consentPolicyVersion: null,
        confirmedAt: null,
        unsubscribedAt: null,
        version: 1,
      },
    },
  ];
  return {
    imported,
    quarantine: reverse ? [...quarantine].reverse() : quarantine,
    counts: { source: sourceCount, imported: 1, quarantined: sourceCount - 1 },
  };
}

function sourceKeys(plan: ReturnType<typeof createLegacyMigrationImportPlan>) {
  return plan.batches.flatMap((batch) => [
    ...batch.input.result.imported.map(
      (record) => `${record.sourceCollection}:${record.sourceRecordId}`,
    ),
    ...batch.input.result.quarantine.map(
      (record) => `${record.sourceCollection}:${record.sourceRecordId}`,
    ),
  ]);
}

describe("legacy migration import plan", () => {
  it("partitions a global manifest into complete deterministic bounded batches", () => {
    const result = migrationResult();
    const plan = createLegacyMigrationImportPlan("synthetic-local", result);
    const reordered = createLegacyMigrationImportPlan(
      "synthetic-local",
      migrationResult(250, true),
    );

    expect(plan).toEqual(reordered);
    expect(plan.globalSourceManifestSha256).toBe(
      legacySourceManifestSha256(result),
    );
    expect(plan.counts).toEqual({
      source: 250,
      imported: 1,
      quarantined: 249,
    });
    expect(
      plan.batches.map((batch) => batch.input.result.counts.source),
    ).toEqual([100, 100, 50]);
    expect(new Set(plan.batches.map((batch) => batch.input.runId)).size).toBe(
      3,
    );

    const keys = sourceKeys(plan);
    expect(keys).toHaveLength(250);
    expect(new Set(keys).size).toBe(250);
    expect([...keys].sort()).toEqual(sourceKeys(reordered).sort());
  });

  it("binds every deterministic run ID to the complete global manifest", () => {
    const original = migrationResult();
    const changeBase = migrationResult();
    const first = changeBase.quarantine[0];
    if (!first) throw new Error("missing fixture disposition");
    const changed: LegacyFirestoreTransformResult = {
      ...changeBase,
      quarantine: [
        { ...first, sourceRecordSha256: sha("changed-source") },
        ...changeBase.quarantine.slice(1),
      ],
    };

    const originalPlan = createLegacyMigrationImportPlan(
      "synthetic-local",
      original,
    );
    const changedPlan = createLegacyMigrationImportPlan(
      "synthetic-local",
      changed,
    );
    expect(changedPlan.globalSourceManifestSha256).not.toBe(
      originalPlan.globalSourceManifestSha256,
    );
    expect(changedPlan.batches.map((batch) => batch.input.runId)).not.toContain(
      originalPlan.batches[2]?.input.runId,
    );
  });

  it("canonicalizes Unicode source IDs without the host locale", () => {
    const result = migrationResult(3);
    const [first, second] = result.quarantine;
    if (!first || !second) throw new Error("missing Unicode fixture records");
    const unicode: LegacyFirestoreTransformResult = {
      ...result,
      quarantine: [
        { ...first, sourceRecordId: "legacy-ä" },
        { ...second, sourceRecordId: "legacy-z" },
      ],
    };
    const tuples = [
      ["customers", "legacy-z", second.sourceRecordSha256, "quarantined"],
      ["customers", "legacy-ä", first.sourceRecordSha256, "quarantined"],
      [
        "newsletter_subscribers",
        "legacy-subscriber-1",
        unicode.imported[0]?.sourceRecordSha256,
        "imported",
      ],
    ];
    const expected = createHash("sha256")
      .update(
        `gioia:legacy-source-manifest:v1\n${tuples.map((tuple) => JSON.stringify(tuple)).join("\n")}`,
      )
      .digest("hex");
    expect(legacySourceManifestSha256(unicode)).toBe(expected);
  });

  it("rejects empty, mismatched, and duplicate global dispositions", () => {
    expect(() =>
      createLegacyMigrationImportPlan("synthetic-local", {
        imported: [],
        quarantine: [],
        counts: { source: 0, imported: 0, quarantined: 0 },
      }),
    ).toThrow("counts do not reconcile");

    const mismatchBase = migrationResult(3);
    const mismatched = {
      ...mismatchBase,
      counts: { ...mismatchBase.counts, source: 4 },
    };
    expect(() =>
      createLegacyMigrationImportPlan("synthetic-local", mismatched),
    ).toThrow("counts do not reconcile");

    const duplicateBase = migrationResult(3);
    const first = duplicateBase.quarantine[0];
    if (!first) throw new Error("missing fixture disposition");
    const duplicate = {
      ...duplicateBase,
      quarantine: [first, { ...first }],
    };
    expect(() =>
      createLegacyMigrationImportPlan("synthetic-local", duplicate),
    ).toThrow("must be unique");
  });

  it("rejects invalid records through the existing single-batch contract", () => {
    const invalidBase = migrationResult(2);
    const imported = invalidBase.imported[0];
    if (!imported) throw new Error("missing fixture import");
    const invalid = {
      ...invalidBase,
      imported: [{ ...imported, sourceRecordSha256: "not-a-hash" }],
    };
    expect(() =>
      createLegacyMigrationImportPlan("synthetic-local", invalid),
    ).toThrow();
  });
});

describe("legacy migration import plan execution", () => {
  it("applies batches sequentially and returns a manifest-bound resume token", async () => {
    const plan = createLegacyMigrationImportPlan(
      "synthetic-local",
      migrationResult(205),
    );
    const seen: string[] = [];
    const apply = vi.fn(
      async (input: (typeof plan.batches)[number]["input"]) => {
        seen.push(input.runId);
        return {
          ...input.result.counts,
          replayed: 0,
        };
      },
    );

    const summary = await executeLegacyMigrationImportPlan(plan, apply);

    expect(seen).toEqual(plan.batches.map((batch) => batch.input.runId));
    expect(summary.batches).toEqual({ total: 3, applied: 3 });
    expect(summary.resume).toEqual({
      globalSourceManifestSha256: plan.globalSourceManifestSha256,
      completedRunIds: seen,
    });
  });

  it("replays every batch after interruption so resume cannot omit records", async () => {
    const plan = createLegacyMigrationImportPlan(
      "synthetic-local",
      migrationResult(205),
    );
    const imported = new Set<string>();
    let interrupted = false;
    const apply = vi.fn(
      async (input: (typeof plan.batches)[number]["input"]) => {
        if (!interrupted && imported.size === 1) {
          interrupted = true;
          throw new Error("synthetic interruption");
        }
        const replayed = imported.has(input.runId)
          ? input.result.counts.source
          : 0;
        imported.add(input.runId);
        return { ...input.result.counts, replayed };
      },
    );

    await expect(executeLegacyMigrationImportPlan(plan, apply)).rejects.toThrow(
      "synthetic interruption",
    );
    const completedRunId = plan.batches[0]?.input.runId;
    if (!completedRunId) throw new Error("missing planned batch");

    const summary = await executeLegacyMigrationImportPlan(plan, apply, {
      globalSourceManifestSha256: plan.globalSourceManifestSha256,
      completedRunIds: [completedRunId],
    });

    expect(apply).toHaveBeenCalledTimes(5);
    expect(summary.batches).toEqual({ total: 3, applied: 3 });
    expect(summary.results[0]?.summary.replayed).toBe(100);
    expect(summary.resume.completedRunIds).toEqual(
      plan.batches.map((batch) => batch.input.runId),
    );
  });

  it("rejects stale or foreign resume state before applying any batch", async () => {
    const plan = createLegacyMigrationImportPlan(
      "synthetic-local",
      migrationResult(2),
    );
    const apply = vi.fn();

    await expect(
      executeLegacyMigrationImportPlan(plan, apply, {
        globalSourceManifestSha256: "00".repeat(32),
        completedRunIds: [],
      }),
    ).rejects.toThrow("manifest does not match");
    await expect(
      executeLegacyMigrationImportPlan(plan, apply, {
        globalSourceManifestSha256: plan.globalSourceManifestSha256,
        completedRunIds: ["a6000000-0000-4000-8000-000000000099"],
      }),
    ).rejects.toThrow("unknown batch run ID");
    expect(apply).not.toHaveBeenCalled();
  });

  it("halts on the first failed batch and rejects inconsistent summaries", async () => {
    const plan = createLegacyMigrationImportPlan(
      "synthetic-local",
      migrationResult(205),
    );
    const failure = vi
      .fn()
      .mockResolvedValueOnce({
        ...plan.batches[0]?.input.result.counts,
        replayed: 0,
      })
      .mockRejectedValueOnce(new Error("synthetic import failure"));

    await expect(
      executeLegacyMigrationImportPlan(plan, failure),
    ).rejects.toThrow("synthetic import failure");
    expect(failure).toHaveBeenCalledTimes(2);

    await expect(
      executeLegacyMigrationImportPlan(plan, async () => ({
        source: 99,
        imported: 0,
        quarantined: 99,
        replayed: 0,
      })),
    ).rejects.toThrow("summary does not reconcile");
  });
});

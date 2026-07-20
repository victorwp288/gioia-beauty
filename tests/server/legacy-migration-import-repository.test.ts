import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import type { LegacyFirestoreTransformResult } from "@/lib/server/migration/legacyFirestoreTransform.ts";
import {
  applyLegacyMigrationImport,
  legacySourceManifestSha256,
  legacyTargetRecordSha256,
  type LegacyMigrationImportDatabase,
} from "@/lib/server/migration/legacyMigrationImportRepository.ts";

const RUN_ID = "a6000000-0000-4000-8000-000000000001";
const TARGET_ID = "a6000000-0000-4000-8000-000000000002";
const INSTANT = "2026-07-20T10:00:00.000Z";

function result(): LegacyFirestoreTransformResult {
  return {
    imported: [
      {
        sourceCollection: "newsletter_subscribers",
        sourceRecordId: "legacy-subscriber-1",
        sourceRecordSha256: "21".repeat(32),
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
    ],
    quarantine: [
      {
        sourceCollection: "customers",
        sourceRecordId: "legacy-invalid-1",
        sourceRecordSha256: "22".repeat(32),
        reasonCode: "INVALID_SOURCE_SHAPE",
        fieldCodes: ["CUSTOMER_DOCUMENT"],
      },
    ],
    counts: { source: 2, imported: 1, quarantined: 1 },
  };
}

function input(migrationResult = result()) {
  return {
    runId: RUN_ID,
    sourceProjectRef: "synthetic-local",
    sourceManifestSha256: legacySourceManifestSha256(migrationResult),
    result: migrationResult,
  };
}

function database(options: { failImport?: boolean; replay?: boolean } = {}) {
  const unsafe = vi.fn(
    async (query: string, _parameters?: readonly unknown[]) => {
      if (query.includes("complete_legacy_migration_import")) {
        return [{ source_count: 2, imported_count: 1, quarantined_count: 1 }];
      }
      if (
        options.failImport &&
        query.includes("apply_legacy_subscriber_import")
      ) {
        throw new Error("synthetic transaction failure");
      }
      if (query.includes("apply_legacy_")) {
        return [{ inserted: !options.replay }];
      }
      return [{ started: !options.replay }];
    },
  );
  const transaction = vi.fn(
    async <T>(callback: (client: { unsafe: typeof unsafe }) => Promise<T>) =>
      callback({ unsafe }),
  );
  return {
    value: { transaction } as unknown as LegacyMigrationImportDatabase,
    transaction,
    unsafe,
  };
}

describe("legacy migration import repository", () => {
  it("applies target, quarantine, ledger, and completion inside one transaction", async () => {
    const mock = database();
    await expect(
      applyLegacyMigrationImport(mock.value, input()),
    ).resolves.toEqual({
      source: 2,
      imported: 1,
      quarantined: 1,
      replayed: 0,
    });

    expect(mock.transaction).toHaveBeenCalledTimes(1);
    expect(mock.unsafe).toHaveBeenCalledTimes(8);
    expect(mock.unsafe.mock.calls.map(([query]) => query)).toEqual([
      "set local lock_timeout = '5s'",
      "set local statement_timeout = '30s'",
      "set local idle_in_transaction_session_timeout = '30s'",
      "set local role gioia_migrator",
      expect.stringContaining("begin_legacy_migration_import"),
      expect.stringContaining("apply_legacy_subscriber_import"),
      expect.stringContaining("apply_legacy_quarantine_import"),
      expect.stringContaining("complete_legacy_migration_import"),
    ]);
    const beginParameters = mock.unsafe.mock.calls[4]?.[1] as unknown[];
    expect(beginParameters).toEqual([
      RUN_ID,
      "synthetic-local",
      Buffer.from(legacySourceManifestSha256(result()), "hex"),
      2,
    ]);
    const subscriberParameters = mock.unsafe.mock.calls[5]?.[1] as unknown[];
    expect(subscriberParameters[1]).toBe("legacy-subscriber-1");
    expect(subscriberParameters[2]).toEqual(
      Buffer.from("21".repeat(32), "hex"),
    );
    expect(subscriberParameters[3]).toEqual(expect.any(Buffer));
    expect((subscriberParameters[3] as Buffer).byteLength).toBe(32);
  });

  it("reports exact record replays without changing the apply call sequence", async () => {
    const mock = database({ replay: true });
    await expect(
      applyLegacyMigrationImport(mock.value, input()),
    ).resolves.toEqual(expect.objectContaining({ replayed: 2 }));
    expect(mock.unsafe).toHaveBeenCalledTimes(8);
  });

  it("rejects oversized and duplicate batches before opening a transaction", async () => {
    const oversized = Array.from({ length: 101 }, (_, index) => ({
      sourceCollection: "customers" as const,
      sourceRecordId: `legacy-invalid-${index}`,
      sourceRecordSha256: "22".repeat(32),
      reasonCode: "INVALID_SOURCE_SHAPE" as const,
      fieldCodes: ["CUSTOMER_DOCUMENT"],
    }));
    const mock = database();
    await expect(
      applyLegacyMigrationImport(
        mock.value,
        input({
          imported: [],
          quarantine: oversized,
          counts: { source: 101, imported: 0, quarantined: 101 },
        }),
      ),
    ).rejects.toThrow();

    const duplicate = result();
    await expect(
      applyLegacyMigrationImport(
        mock.value,
        input({
          imported: duplicate.imported,
          quarantine: [
            {
              ...duplicate.quarantine[0]!,
              sourceCollection: "newsletter_subscribers",
              sourceRecordId: "legacy-subscriber-1",
            },
          ],
          counts: { source: 2, imported: 1, quarantined: 1 },
        }),
      ),
    ).rejects.toThrow();
    expect(mock.transaction).not.toHaveBeenCalled();
  });

  it("rejects a caller manifest that does not bind the exact source dispositions", async () => {
    const mock = database();
    const valid = input();

    await expect(
      applyLegacyMigrationImport(mock.value, {
        ...valid,
        sourceManifestSha256: "11".repeat(32),
      }),
    ).rejects.toThrow("Source manifest does not match migration dispositions");
    await expect(
      applyLegacyMigrationImport(mock.value, {
        ...valid,
        result: {
          ...valid.result,
          quarantine: valid.result.quarantine.map((record) => ({
            ...record,
            sourceRecordSha256: "23".repeat(32),
          })),
        },
      }),
    ).rejects.toThrow("Source manifest does not match migration dispositions");
    expect(mock.transaction).not.toHaveBeenCalled();
  });

  it("derives a byte-stable manifest from sorted identity, hash, and disposition tuples", () => {
    const first = result();
    const reordered: LegacyFirestoreTransformResult = {
      ...first,
      imported: [...first.imported].reverse(),
      quarantine: [...first.quarantine].reverse(),
    };
    expect(legacySourceManifestSha256(reordered)).toBe(
      legacySourceManifestSha256(first),
    );
    expect(
      legacySourceManifestSha256({
        ...first,
        imported: [],
        quarantine: [
          ...first.quarantine,
          {
            sourceCollection: first.imported[0]!.sourceCollection,
            sourceRecordId: first.imported[0]!.sourceRecordId,
            sourceRecordSha256: first.imported[0]!.sourceRecordSha256,
            reasonCode: "INVALID_TARGET_RECORD",
            fieldCodes: ["TARGET_RECORD"],
          },
        ],
        counts: { source: 2, imported: 0, quarantined: 2 },
      }),
    ).not.toBe(legacySourceManifestSha256(first));
  });

  it("propagates an apply failure before completion so the transaction can roll back", async () => {
    const mock = database({ failImport: true });
    await expect(
      applyLegacyMigrationImport(mock.value, input()),
    ).rejects.toThrow("synthetic transaction failure");
    expect(
      mock.unsafe.mock.calls.some(([query]) =>
        String(query).includes("complete_legacy_migration_import"),
      ),
    ).toBe(false);
  });

  it("hashes canonical target records byte-stably and distinguishes changes", () => {
    const left = legacyTargetRecordSha256({ b: 2, a: [true, null] });
    const reordered = legacyTargetRecordSha256({ a: [true, null], b: 2 });
    const changed = legacyTargetRecordSha256({ a: [true, null], b: 3 });
    expect(left).toEqual(reordered);
    expect(left).not.toEqual(changed);
    expect(left.byteLength).toBe(32);
  });
});

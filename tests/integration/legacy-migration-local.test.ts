import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import postgres from "postgres";

vi.mock("server-only", () => ({}));

import { transformLegacyFirestoreBatch } from "@/lib/server/migration/legacyFirestoreTransform.ts";
import {
  applyLegacyMigrationImport,
  legacySourceManifestSha256,
  type LegacyMigrationImportDatabase,
} from "@/lib/server/migration/legacyMigrationImportRepository.ts";
import { getLocalRouteStatus } from "@/scripts/local-owner-auth-harness.mjs";
import {
  legacyFirestoreFixture,
  legacyTransformOptions,
} from "@/tests/server/migration/fixtures/legacyFirestoreFixtures.ts";

const RUN_ID = "a7000000-0000-4000-8000-000000000001";
const enabled = process.env.GIOIA_RUN_LOCAL_MIGRATION_REHEARSAL === "1";
const localDescribe = enabled ? describe : describe.skip;

localDescribe("Local legacy migration vertical rehearsal", () => {
  let admin: ReturnType<typeof postgres> | undefined;
  let database: ReturnType<typeof postgres> | undefined;

  beforeAll(async () => {
    const status = await getLocalRouteStatus();
    const adminUrl = new URL(status.databaseUrl);
    adminUrl.username = "supabase_admin";
    admin = postgres(adminUrl.href, { prepare: false, max: 1 });
    database = postgres(status.databaseUrl, { prepare: false, max: 1 });
    await admin.unsafe(
      "grant gioia_migrator to postgres with inherit false, set true granted by current_user",
    );
  });

  afterAll(async () => {
    if (admin) {
      await admin.unsafe(
        "revoke gioia_migrator from postgres granted by current_user",
      );
      await admin.end({ timeout: 2 });
    }
    if (database) await database.end({ timeout: 2 });
  });

  it("transforms, applies, replays, and reconciles one synthetic batch", async () => {
    if (!admin || !database) {
      throw new Error("Local migration rehearsal database is unavailable");
    }
    const localAdmin = admin;
    const localDatabase = database;
    const batch = legacyFirestoreFixture();
    batch.customers = batch.customers.filter((record) =>
      ["appointment-date", "block-legacy"].includes(record.id),
    );
    const transformed = transformLegacyFirestoreBatch(
      batch,
      legacyTransformOptions(),
    );
    const manifest = legacySourceManifestSha256(transformed);
    const adapter: LegacyMigrationImportDatabase = {
      transaction: async (work) =>
        (await localDatabase.begin(async (transaction) =>
          work({
            unsafe: async (query, parameters) => [
              ...(await transaction.unsafe(
                query,
                parameters as Parameters<typeof transaction.unsafe>[1],
              )),
            ],
          }),
        )) as Awaited<ReturnType<typeof work>>,
    };
    const input = {
      runId: RUN_ID,
      sourceProjectRef: "synthetic-local",
      sourceManifestSha256: manifest,
      result: transformed,
    };

    await expect(applyLegacyMigrationImport(adapter, input)).resolves.toEqual({
      source: 5,
      imported: 5,
      quarantined: 0,
      replayed: 0,
    });
    await expect(applyLegacyMigrationImport(adapter, input)).resolves.toEqual({
      source: 5,
      imported: 5,
      quarantined: 0,
      replayed: 5,
    });

    const evidence = await localAdmin.unsafe(
      `select
         (select count(*)::integer from gioia_private.migration_records
          where run_id = $1::uuid) as records,
         (select count(*)::integer from gioia_private.domain_change_log
          where migration_run_id = $1::uuid) as changes,
         (select count(*)::integer from gioia_private.migration_quarantine
          where run_id = $1::uuid) as quarantine,
         (select counts from gioia_private.migration_runs
          where id = $1::uuid) as counts`,
      [RUN_ID],
    );
    expect(evidence).toEqual([
      {
        records: 5,
        changes: 5,
        quarantine: 0,
        counts: { source: 5, imported: 5, quarantined: 0 },
      },
    ]);

    const changedResult = {
      ...transformed,
      imported: transformed.imported.map((record, index) =>
        index === 0
          ? { ...record, sourceRecordSha256: "ff".repeat(32) }
          : record,
      ),
    };
    await expect(
      applyLegacyMigrationImport(adapter, { ...input, result: changedResult }),
    ).rejects.toThrow("Source manifest does not match migration dispositions");
  });
});

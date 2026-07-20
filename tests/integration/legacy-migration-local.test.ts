import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import postgres from "postgres";

vi.mock("server-only", () => ({}));

import { transformLegacyFirestoreBatch } from "@/lib/server/migration/legacyFirestoreTransform.ts";
import {
  createLegacyMigrationImportPlan,
  executeLegacyMigrationImportPlan,
} from "@/lib/server/migration/legacyMigrationImportPlan.ts";
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
import { largeSyntheticSubscriberResult } from "@/tests/server/migration/fixtures/phase5MigrationImportFixtures.ts";

const RUN_ID = "a7000000-0000-4000-8000-000000000001";
const OVERLAP_RUN_ID = "a7000000-0000-4000-8000-000000000002";
const enabled = process.env.GIOIA_RUN_LOCAL_MIGRATION_REHEARSAL === "1";
const localDescribe = enabled ? describe : describe.skip;

function migrationDatabase(
  database: NonNullable<ReturnType<typeof postgres>>,
): LegacyMigrationImportDatabase {
  return {
    transaction: async (work) =>
      (await database.begin(async (transaction) =>
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
}

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
    const adapter = migrationDatabase(localDatabase);
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

  it("rejects overlapping imported appointments atomically", async () => {
    if (!admin || !database) {
      throw new Error("Local migration rehearsal database is unavailable");
    }
    const batch = legacyFirestoreFixture();
    const source = batch.customers.find(
      (record) => record.id === "appointment-date",
    );
    if (
      !source ||
      !source.data ||
      typeof source.data !== "object" ||
      Array.isArray(source.data)
    ) {
      throw new Error("Synthetic appointment fixture is missing");
    }
    const sourceData = source.data as Record<string, unknown>;
    batch.customers = [
      {
        id: "phase5-overlap-a",
        data: {
          ...sourceData,
          selectedDate: "2026-01-20",
          startTime: "14:30",
        },
      },
      {
        id: "phase5-overlap-b",
        data: {
          ...sourceData,
          name: "Cliente sintetico sovrapposto",
          email: "overlap@example.test",
          selectedDate: "2026-01-20",
          startTime: "14:45",
        },
      },
    ];
    batch.vacations = [];
    batch.newsletterSubscribers = [];
    const transformed = transformLegacyFirestoreBatch(
      batch,
      legacyTransformOptions(),
    );
    expect(transformed.counts).toEqual({
      source: 2,
      imported: 2,
      quarantined: 0,
    });

    await expect(
      applyLegacyMigrationImport(migrationDatabase(database), {
        runId: OVERLAP_RUN_ID,
        sourceProjectRef: "synthetic-overlap-local",
        sourceManifestSha256: legacySourceManifestSha256(transformed),
        result: transformed,
      }),
    ).rejects.toMatchObject({ code: "23P01" });

    const evidence = await admin.unsafe(
      `select
         (select count(*)::integer from gioia_private.migration_runs
          where id = $1::uuid) as runs,
         (select count(*)::integer from gioia_private.migration_records
          where run_id = $1::uuid) as records,
         (select count(*)::integer from gioia_private.domain_change_log
          where migration_run_id = $1::uuid) as changes,
         (select count(*)::integer from gioia_private.schedule_entries
          where legacy_firestore_id in ('phase5-overlap-a', 'phase5-overlap-b'))
           as entries,
         (select count(*)::integer
          from gioia_private.schedule_entries as left_entry
          join gioia_private.schedule_entries as right_entry
            on left_entry.id < right_entry.id
           and left_entry.local_date = right_entry.local_date
           and left_entry.occupied_span && right_entry.occupied_span
          where left_entry.status in ('confirmed', 'completed', 'active')
            and right_entry.status in ('confirmed', 'completed', 'active'))
           as active_overlaps`,
      [OVERLAP_RUN_ID],
    );
    expect(evidence).toEqual([
      {
        runs: 0,
        records: 0,
        changes: 0,
        entries: 0,
        active_overlaps: 0,
      },
    ]);
  });

  it("restarts a deterministic multi-batch import through database replay", async () => {
    if (!admin || !database) {
      throw new Error("Local migration rehearsal database is unavailable");
    }
    const result = largeSyntheticSubscriberResult();
    const plan = createLegacyMigrationImportPlan(
      "synthetic-multibatch-local",
      result,
    );
    expect(
      plan.batches.map((batch) => batch.input.result.counts.source),
    ).toEqual([100, 100, 5]);
    const adapter = migrationDatabase(database);
    const apply = (input: (typeof plan.batches)[number]["input"]) =>
      applyLegacyMigrationImport(adapter, input);

    const firstBatch = plan.batches[0];
    if (!firstBatch) throw new Error("Synthetic migration plan is empty");
    await expect(apply(firstBatch.input)).resolves.toEqual({
      source: 100,
      imported: 100,
      quarantined: 0,
      replayed: 0,
    });
    const resumed = await executeLegacyMigrationImportPlan(plan, apply, {
      globalSourceManifestSha256: plan.globalSourceManifestSha256,
      completedRunIds: [firstBatch.input.runId],
    });
    expect(resumed.results.map((item) => item.summary.replayed)).toEqual([
      100, 0, 0,
    ]);
    const replay = await executeLegacyMigrationImportPlan(
      plan,
      apply,
      resumed.resume,
    );
    expect(
      replay.results.reduce((sum, item) => sum + item.summary.replayed, 0),
    ).toBe(205);

    const runIds = plan.batches.map((batch) => batch.input.runId);
    const evidence = await admin.unsafe(
      `select
         (select count(*)::integer from gioia_private.migration_runs
          where id = any($1::uuid[])) as runs,
         (select count(*)::integer from gioia_private.migration_records
          where run_id = any($1::uuid[])) as records,
         (select count(*)::integer from gioia_private.newsletter_subscribers
          where legacy_firestore_id like 'phase5-subscriber-%') as subscribers,
         (select count(*)::integer from gioia_private.domain_change_log
          where migration_run_id = any($1::uuid[])) as changes`,
      [runIds],
    );
    expect(evidence).toEqual([
      { runs: 3, records: 205, subscribers: 205, changes: 205 },
    ]);
  });
});

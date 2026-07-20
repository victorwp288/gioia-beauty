import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import postgres from "postgres";

vi.mock("server-only", () => ({}));

import { compileLegacyFirestoreReversePlan } from "@/lib/server/migration/legacyFirestoreReverse.ts";
import {
  extractLegacyFirestoreReverseInput,
  type LegacyFirestoreReverseExtractDatabase,
} from "@/lib/server/migration/legacyFirestoreReverseRepository.ts";
import { getLocalRouteStatus } from "@/scripts/local-owner-auth-harness.mjs";

const AGGREGATE_ID = "c7000000-0000-4000-8000-000000000001";
const enabled = process.env.GIOIA_RUN_LOCAL_MIGRATION_REHEARSAL === "1";
const localDescribe = enabled ? describe : describe.skip;

function reverseDatabase(
  database: NonNullable<ReturnType<typeof postgres>>,
): LegacyFirestoreReverseExtractDatabase {
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

localDescribe("Local legacy Firestore reverse extraction", () => {
  let admin: ReturnType<typeof postgres> | undefined;
  let database: ReturnType<typeof postgres> | undefined;

  beforeAll(async () => {
    const status = await getLocalRouteStatus();
    const adminUrl = new URL(status.databaseUrl);
    adminUrl.username = "supabase_admin";
    admin = postgres(adminUrl.href, { prepare: false, max: 1 });
    database = postgres(status.databaseUrl, { prepare: false, max: 1 });
    await admin.unsafe(
      "grant gioia_mutator to postgres with inherit false, set true granted by current_user",
    );
  });

  afterAll(async () => {
    if (admin) {
      await admin.unsafe(
        "delete from gioia_private.domain_change_log where aggregate_id = $1::uuid",
        [AGGREGATE_ID],
      );
      await admin.unsafe(
        "delete from gioia_private.newsletter_subscribers where id = $1::uuid",
        [AGGREGATE_ID],
      );
      await admin.unsafe(
        "revoke gioia_mutator from postgres granted by current_user",
      );
      await admin.end({ timeout: 2 });
    }
    if (database) await database.end({ timeout: 2 });
  });

  it("extracts repeated aggregate versions across a real sequence gap", async () => {
    if (!admin || !database) {
      throw new Error("Local reverse rehearsal database is unavailable");
    }
    const [prior] = await admin.unsafe(
      "select coalesce(max(sequence_id), 0)::integer as high_water from gioia_private.domain_change_log",
    );
    const afterSequence = Number(prior?.high_water);
    await admin.begin(async (transaction) => {
      await transaction.unsafe(
        `insert into gioia_private.newsletter_subscribers (
           id, email, status, source, legacy_firestore_id,
           timestamp_provenance, imported_at, version
         ) values ($1::uuid, 'reverse-local@example.test', 'legacy_unverified',
           'migration', 'phase5-reverse-local', 'import_time',
           '2026-07-20T12:00:00.000Z'::timestamptz, 1)`,
        [AGGREGATE_ID],
      );
      await transaction.unsafe(
        `insert into gioia_private.domain_change_log (
           aggregate_kind, aggregate_id, aggregate_version, change_kind,
           source, changed_fields
         ) values ('subscriber', $1::uuid, 1, 'subscribe', 'system',
           array['email', 'status'])`,
        [AGGREGATE_ID],
      );
      await transaction.unsafe(
        "select nextval('gioia_private.domain_change_log_sequence_id_seq')",
      );
      await transaction.unsafe(
        `update gioia_private.newsletter_subscribers
         set version = 2, updated_at = '2026-07-20T12:01:00.000Z'
         where id = $1::uuid`,
        [AGGREGATE_ID],
      );
      await transaction.unsafe(
        `insert into gioia_private.domain_change_log (
           aggregate_kind, aggregate_id, aggregate_version, change_kind,
           source, changed_fields
         ) values ('subscriber', $1::uuid, 2, 'update', 'system',
           array['updated_at', 'version'])`,
        [AGGREGATE_ID],
      );
    });

    const input = await extractLegacyFirestoreReverseInput(
      reverseDatabase(database),
      { afterSequence, limit: 500 },
    );
    expect(input.changes.map((change) => change.aggregateVersion)).toEqual([
      1, 2,
    ]);
    expect(input.changes[1]!.sequenceId - input.changes[0]!.sequenceId).toBe(2);
    expect(input.subscribers).toMatchObject([{ id: AGGREGATE_ID, version: 2 }]);
    expect(compileLegacyFirestoreReversePlan(input)).toMatchObject({
      complete: true,
      counts: { sourceChanges: 2, operations: 1 },
      throughSequence: input.sourceHighWaterSequence,
    });
  });
});

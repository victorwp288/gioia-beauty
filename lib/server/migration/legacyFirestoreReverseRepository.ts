import "server-only";

import { z } from "zod";

import type { LegacyFirestoreReverseInput } from "./legacyFirestoreReverseContract.ts";
import {
  parseChanges,
  parseHighWater,
  parseSchedule,
  parseSubscriber,
  parseVacation,
  validateSnapshot,
} from "./legacyFirestoreReverseRepositorySupport.ts";

interface ReverseExtractTransaction {
  unsafe(
    query: string,
    parameters?: readonly unknown[],
  ): Promise<Record<string, unknown>[]>;
}

export interface LegacyFirestoreReverseExtractDatabase {
  transaction<T>(
    callback: (transaction: ReverseExtractTransaction) => Promise<T>,
  ): Promise<T>;
}

const ExtractRequestSchema = z
  .object({
    afterSequence: z.number().int().nonnegative(),
    limit: z.number().int().min(1).max(500),
  })
  .strict();

const MAX_CHANGE_ROWS = 10_000;
const CHANGE_QUERY_ROWS = MAX_CHANGE_ROWS + 1;

const SCHEDULE_SELECT = `
  select id::text, legacy_firestore_id, kind, status, local_date::text,
         start_minutes, service_duration_minutes, buffer_minutes,
         service_name_snapshot, variant_name_snapshot, client_name,
         client_email::text, client_phone, client_note, internal_note,
         cancelled_at, cancellation_reason, version, created_at, updated_at
  from gioia_private.schedule_entries
  where id = any($1::uuid[])
  order by id
`;

const VACATION_SELECT = `
  select id::text, legacy_firestore_id, start_date::text, end_date::text,
         status, reason, cancelled_at, version, created_at, updated_at
  from gioia_private.vacations
  where id = any($1::uuid[])
  order by id
`;

const SUBSCRIBER_SELECT = `
  select id::text, legacy_firestore_id, email::text, status, unsubscribed_at,
         version, created_at, updated_at
  from gioia_private.newsletter_subscribers
  where id = any($1::uuid[])
  order by id
`;

function idsFor(
  changes: LegacyFirestoreReverseInput["changes"],
  kind: LegacyFirestoreReverseInput["changes"][number]["aggregateKind"],
): string[] {
  return [
    ...new Set(
      changes
        .filter((change) => change.aggregateKind === kind)
        .map((change) => change.aggregateId),
    ),
  ].sort();
}

export async function extractLegacyFirestoreReverseInput(
  database: LegacyFirestoreReverseExtractDatabase,
  request: Readonly<{ afterSequence: number; limit: number }>,
): Promise<LegacyFirestoreReverseInput> {
  const parsed = ExtractRequestSchema.parse(request);
  return database.transaction(async (transaction) => {
    await transaction.unsafe(
      "set transaction isolation level repeatable read, read only",
    );
    await transaction.unsafe("set local statement_timeout = '30s'");
    await transaction.unsafe("set local lock_timeout = '5s'");
    await transaction.unsafe(
      "set local idle_in_transaction_session_timeout = '30s'",
    );
    await transaction.unsafe("set local role gioia_mutator");

    const sourceHighWaterSequence = parseHighWater(
      await transaction.unsafe(
        `select coalesce(max(sequence_id), 0)::text
           as source_high_water_sequence
         from gioia_private.domain_change_log`,
      ),
    );
    if (parsed.afterSequence > sourceHighWaterSequence) {
      throw new Error("REVERSE_CURSOR_EXCEEDS_HIGH_WATER");
    }
    const changes = parseChanges(
      await transaction.unsafe(
        `select sequence_id::text, aggregate_kind, aggregate_id::text,
                aggregate_version, change_kind, schema_version
         from gioia_private.domain_change_log
         where sequence_id > $1::bigint and sequence_id <= $2::bigint
         order by sequence_id
         limit ${CHANGE_QUERY_ROWS}`,
        [parsed.afterSequence, sourceHighWaterSequence],
      ),
      parsed.afterSequence,
      sourceHighWaterSequence,
    );

    const scheduleEntries = (
      await transaction.unsafe(SCHEDULE_SELECT, [
        idsFor(changes, "schedule_entry"),
      ])
    ).map(parseSchedule);
    const vacations = (
      await transaction.unsafe(VACATION_SELECT, [idsFor(changes, "vacation")])
    ).map(parseVacation);
    const subscribers = (
      await transaction.unsafe(SUBSCRIBER_SELECT, [
        idsFor(changes, "subscriber"),
      ])
    ).map(parseSubscriber);

    const lastSequence = changes.at(-1)?.sequenceId ?? parsed.afterSequence;
    return validateSnapshot({
      afterSequence: parsed.afterSequence,
      sourceHighWaterSequence,
      sourceExhausted: lastSequence === sourceHighWaterSequence,
      limit: parsed.limit,
      changes,
      scheduleEntries,
      vacations,
      subscribers,
    });
  });
}

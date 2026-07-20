import type { LegacyFirestoreReverseExtractDatabase } from "@/lib/server/migration/legacyFirestoreReverseRepository.ts";

export const reverseInstant = "2026-07-20T12:00:00.000Z";
export const reverseScheduleId = "10000000-0000-4000-8000-000000000001";
export const reverseVacationId = "10000000-0000-4000-8000-000000000002";
export const reverseSubscriberId = "10000000-0000-4000-8000-000000000003";

export function reverseChange(
  sequenceId: number,
  aggregateKind: string,
  aggregateId: string,
  aggregateVersion = 1,
  changeKind = "create",
) {
  return {
    sequence_id: String(sequenceId),
    aggregate_kind: aggregateKind,
    aggregate_id: aggregateId,
    aggregate_version: aggregateVersion,
    change_kind: changeKind,
    schema_version: 1,
  };
}

export function reverseSchedule(version = 1) {
  return {
    id: reverseScheduleId,
    legacy_firestore_id: "legacy-schedule",
    kind: "appointment",
    status: "confirmed",
    local_date: "2026-08-10",
    start_minutes: 600,
    service_duration_minutes: 45,
    buffer_minutes: 5,
    service_name_snapshot: "Manicure",
    variant_name_snapshot: "45 minuti",
    client_name: "Cliente Sintetico",
    client_email: "cliente@example.test",
    client_phone: null,
    client_note: null,
    internal_note: null,
    cancelled_at: null,
    cancellation_reason: null,
    version,
    created_at: new Date(reverseInstant),
    updated_at: reverseInstant,
  };
}

export function reverseVacation() {
  return {
    id: reverseVacationId,
    legacy_firestore_id: "legacy-vacation",
    start_date: "2026-08-20",
    end_date: "2026-08-21",
    status: "active",
    reason: null,
    cancelled_at: null,
    version: 1,
    created_at: reverseInstant,
    updated_at: reverseInstant,
  };
}

export function reverseSubscriber() {
  return {
    id: reverseSubscriberId,
    legacy_firestore_id: "legacy-subscriber",
    email: "subscriber@example.test",
    status: "active",
    unsubscribed_at: null,
    version: 1,
    created_at: reverseInstant,
    updated_at: reverseInstant,
  };
}

interface FixtureOptions {
  highWater?: number;
  changes?: Record<string, unknown>[];
  schedules?: Record<string, unknown>[];
  vacations?: Record<string, unknown>[];
  subscribers?: Record<string, unknown>[];
}

export function reverseRepositoryDatabase(options: FixtureOptions = {}) {
  const queries: Array<{ sql: string; parameters?: readonly unknown[] }> = [];
  const rows = {
    highWater: options.highWater ?? 3,
    changes: options.changes ?? [
      reverseChange(1, "schedule_entry", reverseScheduleId),
      reverseChange(2, "vacation", reverseVacationId),
      reverseChange(3, "subscriber", reverseSubscriberId, 1, "subscribe"),
    ],
    schedules: options.schedules ?? [reverseSchedule()],
    vacations: options.vacations ?? [reverseVacation()],
    subscribers: options.subscribers ?? [reverseSubscriber()],
  };
  const target: LegacyFirestoreReverseExtractDatabase = {
    async transaction(work) {
      return work({
        async unsafe(sql, parameters) {
          queries.push({ sql, parameters });
          if (sql.includes("max(sequence_id)")) {
            return [{ source_high_water_sequence: String(rows.highWater) }];
          }
          if (sql.includes("from gioia_private.domain_change_log")) {
            return rows.changes;
          }
          if (sql.includes("from gioia_private.schedule_entries")) {
            return rows.schedules;
          }
          if (sql.includes("from gioia_private.vacations")) {
            return rows.vacations;
          }
          if (sql.includes("from gioia_private.newsletter_subscribers")) {
            return rows.subscribers;
          }
          return [];
        },
      });
    },
  };
  return { target, queries };
}

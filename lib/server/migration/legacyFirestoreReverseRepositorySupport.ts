import "server-only";

import {
  LegacyFirestoreReverseInputSchema,
  type LegacyFirestoreChange,
  type LegacyFirestoreReverseInput,
} from "./legacyFirestoreReverseContract.ts";

type Row = Readonly<Record<string, unknown>>;
type Kind = LegacyFirestoreChange["aggregateKind"];

const KINDS = new Set<Kind>(["schedule_entry", "vacation", "subscriber"]);
const CHANGES = new Set<LegacyFirestoreChange["changeKind"]>([
  "create",
  "update",
  "reschedule",
  "cancel",
  "block",
  "subscribe",
  "unsubscribe",
]);
const SCHEDULE_KINDS = new Set(["appointment", "block"] as const);
const SCHEDULE_STATUSES = new Set([
  "confirmed",
  "completed",
  "cancelled",
  "no_show",
  "active",
] as const);
const VACATION_STATUSES = new Set(["active", "cancelled"] as const);
const SUBSCRIBER_STATUSES = new Set([
  "legacy_unverified",
  "pending",
  "active",
  "unsubscribed",
  "bounced",
  "complained",
] as const);

function integer(value: unknown, code: string): number {
  const parsed = typeof value === "number" ? value : Number(value);
  if (!Number.isSafeInteger(parsed)) throw new Error(code);
  return parsed;
}

function text(value: unknown, code: string): string {
  if (typeof value !== "string") throw new Error(code);
  return value;
}

function nullableText(value: unknown, code: string): string | null {
  return value === null ? null : text(value, code);
}

function instant(value: unknown, code: string): string {
  const parsed = value instanceof Date ? value : new Date(text(value, code));
  if (!Number.isFinite(parsed.getTime())) throw new Error(code);
  return parsed.toISOString();
}

function nullableInstant(value: unknown, code: string): string | null {
  return value === null ? null : instant(value, code);
}

function knownValue<T extends string>(
  value: unknown,
  values: ReadonlySet<T>,
  code: string,
): T {
  if (typeof value !== "string" || !values.has(value as T)) {
    throw new Error(code);
  }
  return value as T;
}

export function parseHighWater(rows: readonly Row[]): number {
  if (rows.length !== 1) throw new Error("REVERSE_SOURCE_HIGH_WATER_INVALID");
  const value = integer(
    rows[0]?.source_high_water_sequence,
    "REVERSE_SOURCE_HIGH_WATER_INVALID",
  );
  if (value < 0) throw new Error("REVERSE_SOURCE_HIGH_WATER_INVALID");
  return value;
}

export function parseChanges(
  rows: readonly Row[],
  afterSequence: number,
  highWater: number,
): LegacyFirestoreChange[] {
  // Target tables retain only current state, so a truncated change window
  // cannot reconstruct aggregates changed again beyond the truncation point.
  if (rows.length > 10_000) {
    throw new Error("REVERSE_CHANGE_WINDOW_EXCEEDED");
  }
  const changes = rows.map((row) => {
    const sequenceId = integer(row.sequence_id, "REVERSE_SEQUENCE_INVALID");
    const aggregateKind = row.aggregate_kind;
    const changeKind = row.change_kind;
    if (!KINDS.has(aggregateKind as Kind)) {
      throw new Error("REVERSE_AGGREGATE_KIND_UNSUPPORTED");
    }
    if (!CHANGES.has(changeKind as LegacyFirestoreChange["changeKind"])) {
      throw new Error("REVERSE_CHANGE_KIND_UNSUPPORTED");
    }
    if (integer(row.schema_version, "REVERSE_SCHEMA_VERSION_INVALID") !== 1) {
      throw new Error("REVERSE_SCHEMA_VERSION_UNSUPPORTED");
    }
    return {
      sequenceId,
      aggregateKind: aggregateKind as Kind,
      aggregateId: text(row.aggregate_id, "REVERSE_AGGREGATE_ID_INVALID"),
      aggregateVersion: integer(
        row.aggregate_version,
        "REVERSE_AGGREGATE_VERSION_INVALID",
      ),
      changeKind: changeKind as LegacyFirestoreChange["changeKind"],
    };
  });
  const eventKeys = new Set<string>();
  const versionKeys = new Set<string>();
  const aggregateVersions = new Map<string, number>();
  changes.forEach((change, index) => {
    if (
      change.sequenceId <=
        (index === 0 ? afterSequence : changes[index - 1]!.sequenceId) ||
      change.sequenceId > highWater
    ) {
      throw new Error("REVERSE_SEQUENCE_WINDOW_DISCONTINUOUS");
    }
    const eventKey = String(change.sequenceId);
    const versionKey = `${change.aggregateKind}:${change.aggregateId}:${change.aggregateVersion}`;
    if (eventKeys.has(eventKey) || versionKeys.has(versionKey)) {
      throw new Error("REVERSE_CHANGE_DUPLICATE");
    }
    const aggregateKey = `${change.aggregateKind}:${change.aggregateId}`;
    const priorVersion = aggregateVersions.get(aggregateKey);
    if (
      priorVersion !== undefined &&
      change.aggregateVersion !== priorVersion + 1
    ) {
      throw new Error("REVERSE_AGGREGATE_VERSION_DISCONTINUOUS");
    }
    eventKeys.add(eventKey);
    versionKeys.add(versionKey);
    aggregateVersions.set(aggregateKey, change.aggregateVersion);
  });
  return changes;
}

export function parseSchedule(
  row: Row,
): LegacyFirestoreReverseInput["scheduleEntries"][number] {
  return {
    id: text(row.id, "REVERSE_SCHEDULE_ROW_INVALID"),
    legacyFirestoreId: nullableText(
      row.legacy_firestore_id,
      "REVERSE_SCHEDULE_ROW_INVALID",
    ),
    kind: knownValue(row.kind, SCHEDULE_KINDS, "REVERSE_SCHEDULE_ROW_INVALID"),
    status: knownValue(
      row.status,
      SCHEDULE_STATUSES,
      "REVERSE_SCHEDULE_ROW_INVALID",
    ),
    localDate: text(row.local_date, "REVERSE_SCHEDULE_ROW_INVALID"),
    startMinutes: integer(row.start_minutes, "REVERSE_SCHEDULE_ROW_INVALID"),
    serviceDurationMinutes: integer(
      row.service_duration_minutes,
      "REVERSE_SCHEDULE_ROW_INVALID",
    ),
    bufferMinutes: integer(row.buffer_minutes, "REVERSE_SCHEDULE_ROW_INVALID"),
    serviceNameSnapshot: nullableText(
      row.service_name_snapshot,
      "REVERSE_SCHEDULE_ROW_INVALID",
    ),
    variantNameSnapshot: nullableText(
      row.variant_name_snapshot,
      "REVERSE_SCHEDULE_ROW_INVALID",
    ),
    clientName: nullableText(row.client_name, "REVERSE_SCHEDULE_ROW_INVALID"),
    clientEmail: nullableText(row.client_email, "REVERSE_SCHEDULE_ROW_INVALID"),
    clientPhone: nullableText(row.client_phone, "REVERSE_SCHEDULE_ROW_INVALID"),
    clientNote: nullableText(row.client_note, "REVERSE_SCHEDULE_ROW_INVALID"),
    internalNote: nullableText(
      row.internal_note,
      "REVERSE_SCHEDULE_ROW_INVALID",
    ),
    cancelledAt: nullableInstant(
      row.cancelled_at,
      "REVERSE_SCHEDULE_ROW_INVALID",
    ),
    cancellationReason: nullableText(
      row.cancellation_reason,
      "REVERSE_SCHEDULE_ROW_INVALID",
    ),
    version: integer(row.version, "REVERSE_SCHEDULE_ROW_INVALID"),
    createdAt: instant(row.created_at, "REVERSE_SCHEDULE_ROW_INVALID"),
    updatedAt: instant(row.updated_at, "REVERSE_SCHEDULE_ROW_INVALID"),
  };
}

export function parseVacation(
  row: Row,
): LegacyFirestoreReverseInput["vacations"][number] {
  return {
    id: text(row.id, "REVERSE_VACATION_ROW_INVALID"),
    legacyFirestoreId: nullableText(
      row.legacy_firestore_id,
      "REVERSE_VACATION_ROW_INVALID",
    ),
    startDate: text(row.start_date, "REVERSE_VACATION_ROW_INVALID"),
    endDate: text(row.end_date, "REVERSE_VACATION_ROW_INVALID"),
    status: knownValue(
      row.status,
      VACATION_STATUSES,
      "REVERSE_VACATION_ROW_INVALID",
    ),
    reason: nullableText(row.reason, "REVERSE_VACATION_ROW_INVALID"),
    cancelledAt: nullableInstant(
      row.cancelled_at,
      "REVERSE_VACATION_ROW_INVALID",
    ),
    version: integer(row.version, "REVERSE_VACATION_ROW_INVALID"),
    createdAt: instant(row.created_at, "REVERSE_VACATION_ROW_INVALID"),
    updatedAt: instant(row.updated_at, "REVERSE_VACATION_ROW_INVALID"),
  };
}

export function parseSubscriber(
  row: Row,
): LegacyFirestoreReverseInput["subscribers"][number] {
  return {
    id: text(row.id, "REVERSE_SUBSCRIBER_ROW_INVALID"),
    legacyFirestoreId: nullableText(
      row.legacy_firestore_id,
      "REVERSE_SUBSCRIBER_ROW_INVALID",
    ),
    email: text(row.email, "REVERSE_SUBSCRIBER_ROW_INVALID"),
    status: knownValue(
      row.status,
      SUBSCRIBER_STATUSES,
      "REVERSE_SUBSCRIBER_ROW_INVALID",
    ),
    unsubscribedAt: nullableInstant(
      row.unsubscribed_at,
      "REVERSE_SUBSCRIBER_ROW_INVALID",
    ),
    version: integer(row.version, "REVERSE_SUBSCRIBER_ROW_INVALID"),
    createdAt: instant(row.created_at, "REVERSE_SUBSCRIBER_ROW_INVALID"),
    updatedAt: instant(row.updated_at, "REVERSE_SUBSCRIBER_ROW_INVALID"),
  };
}

export function validateSnapshot(
  input: LegacyFirestoreReverseInput,
): LegacyFirestoreReverseInput {
  const rows = new Map<string, number>();
  for (const [kind, values] of [
    ["schedule_entry", input.scheduleEntries],
    ["vacation", input.vacations],
    ["subscriber", input.subscribers],
  ] as const) {
    for (const row of values) {
      const key = `${kind}:${row.id}`;
      if (rows.has(key)) throw new Error("REVERSE_TARGET_ROW_DUPLICATE");
      rows.set(key, row.version);
    }
  }
  const expected = new Map<string, number>();
  for (const change of input.changes) {
    expected.set(
      `${change.aggregateKind}:${change.aggregateId}`,
      change.aggregateVersion,
    );
  }
  for (const [key, version] of expected) {
    if (!rows.has(key)) throw new Error("REVERSE_TARGET_ROW_MISSING");
    if (rows.get(key) !== version) {
      throw new Error("REVERSE_TARGET_VERSION_MISMATCH");
    }
  }
  if (rows.size !== expected.size) throw new Error("REVERSE_TARGET_ROW_EXTRA");
  return LegacyFirestoreReverseInputSchema.parse(input);
}

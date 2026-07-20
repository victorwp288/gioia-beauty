import "server-only";

import { createHash } from "node:crypto";

import {
  asMinuteOfDay,
  asSalonDate,
  romeLocalToInstant,
} from "@/lib/domain/booking/index.ts";
import {
  LegacyFirestoreReverseInputSchema,
  type LegacyFirestoreChange as Change,
  type LegacyFirestoreReverseInput as Input,
  type LegacyFirestoreReverseOperation,
  type LegacyFirestoreSchedule as Schedule,
} from "./legacyFirestoreReverseContract.ts";

export type { LegacyFirestoreReverseOperation } from "./legacyFirestoreReverseContract.ts";

function documentId(id: string, legacyId: string | null): string {
  return legacyId ?? `supabase_${id}`;
}

function minutes(value: number): string {
  if (!Number.isInteger(value) || value < 0 || value > 1_440) {
    throw new Error("REVERSE_TIME_OUT_OF_RANGE");
  }
  return `${String(Math.floor(value / 60)).padStart(2, "0")}:${String(value % 60).padStart(2, "0")}`;
}

function firestoreTimestampAtRomeMidnight(localDate: string) {
  const instant = romeLocalToInstant(asSalonDate(localDate), asMinuteOfDay(0));
  return Object.freeze({
    valueType: "firestore_timestamp",
    seconds: Math.floor(instant.getTime() / 1_000),
    nanoseconds: (instant.getTime() % 1_000) * 1_000_000,
  });
}

function firestoreDeleteField() {
  return Object.freeze({ valueType: "firestore_delete_field" });
}

function operation(
  change: Change,
  collection: LegacyFirestoreReverseOperation["collection"],
  legacyId: string | null,
  version: number,
  payload: Record<string, unknown>,
): LegacyFirestoreReverseOperation {
  const encoded = JSON.stringify(payload);
  return Object.freeze({
    collection,
    documentId: documentId(change.aggregateId, legacyId),
    sourceSequenceId: change.sequenceId,
    aggregateId: change.aggregateId,
    aggregateVersion: version,
    action: "set",
    merge: true,
    payload: Object.freeze(payload),
    payloadSha256: createHash("sha256").update(encoded).digest("hex"),
  });
}

function deleteOperation(
  change: Change,
  collection: LegacyFirestoreReverseOperation["collection"],
  legacyId: string | null,
  version: number,
): LegacyFirestoreReverseOperation {
  const targetId = documentId(change.aggregateId, legacyId);
  return Object.freeze({
    collection,
    documentId: targetId,
    sourceSequenceId: change.sequenceId,
    aggregateId: change.aggregateId,
    aggregateVersion: version,
    action: "delete",
    merge: false,
    payload: null,
    payloadSha256: createHash("sha256")
      .update(`delete\0${collection}\0${targetId}`)
      .digest("hex"),
  });
}

function scheduleOperation(change: Change, row: Schedule) {
  if (row.status === "cancelled") {
    return deleteOperation(
      change,
      "customers",
      row.legacyFirestoreId,
      row.version,
    );
  }
  const totalDuration = row.serviceDurationMinutes + row.bufferMinutes;
  const common = {
    selectedDate: firestoreTimestampAtRomeMidnight(row.localDate),
    startTime: minutes(row.startMinutes),
    endTime: minutes(row.startMinutes + totalDuration),
    duration: row.serviceDurationMinutes,
    totalDuration,
    status: row.kind === "block" ? "confirmed" : row.status,
    supabase_id: row.id,
    supabase_version: row.version,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
  const payload =
    row.kind === "block"
      ? {
          ...common,
          name: "Blocco Orario",
          email: "",
          number: "",
          appointmentType: "Blocco Orario",
          variant: "",
          note: row.internalNote ?? "",
          isTimeBlock: true,
        }
      : {
          ...common,
          name: row.clientName,
          email: row.clientEmail ?? "",
          number: row.clientPhone ?? "",
          appointmentType: row.serviceNameSnapshot,
          variant: String(row.serviceDurationMinutes),
          note: row.clientNote ?? "",
          isTimeBlock: false,
        };
  return operation(
    change,
    "customers",
    row.legacyFirestoreId,
    row.version,
    payload,
  );
}

function selectChanges(input: Input): Change[] {
  const latest = new Map<string, Change>();
  for (const change of input.changes
    .filter((item) => item.sequenceId > input.afterSequence)
    .sort((left, right) => left.sequenceId - right.sequenceId)) {
    latest.set(`${change.aggregateKind}:${change.aggregateId}`, change);
  }
  return [...latest.values()]
    .sort((left, right) => left.sequenceId - right.sequenceId)
    .slice(0, input.limit);
}

export function compileLegacyFirestoreReversePlan(input: unknown) {
  const parsed = LegacyFirestoreReverseInputSchema.parse(input);
  const pendingChanges = parsed.changes
    .filter((change) => change.sequenceId > parsed.afterSequence)
    .sort((left, right) => left.sequenceId - right.sequenceId);
  const selected = selectChanges(parsed);
  const schedule = new Map(parsed.scheduleEntries.map((row) => [row.id, row]));
  const vacations = new Map(parsed.vacations.map((row) => [row.id, row]));
  const subscribers = new Map(parsed.subscribers.map((row) => [row.id, row]));
  const operations = selectChanges(parsed).map((change) => {
    if (change.aggregateKind === "schedule_entry") {
      const row = schedule.get(change.aggregateId);
      if (!row) throw new Error("REVERSE_TARGET_ROW_MISSING");
      if (row.version !== change.aggregateVersion) {
        throw new Error("REVERSE_TARGET_VERSION_MISMATCH");
      }
      return scheduleOperation(change, row);
    }
    if (change.aggregateKind === "vacation") {
      const row = vacations.get(change.aggregateId);
      if (!row) throw new Error("REVERSE_TARGET_ROW_MISSING");
      if (row.version !== change.aggregateVersion) {
        throw new Error("REVERSE_TARGET_VERSION_MISMATCH");
      }
      if (row.status === "cancelled") {
        return deleteOperation(
          change,
          "vacations",
          row.legacyFirestoreId,
          row.version,
        );
      }
      return operation(
        change,
        "vacations",
        row.legacyFirestoreId,
        row.version,
        {
          startDate: `${row.startDate}T00:00:00.000Z`,
          endDate: `${row.endDate}T00:00:00.000Z`,
          reason: row.reason ?? "",
          status: row.status,
          supabase_id: row.id,
          supabase_version: row.version,
          createdAt: row.createdAt,
          updatedAt: row.updatedAt,
        },
      );
    }
    const row = subscribers.get(change.aggregateId);
    if (!row) throw new Error("REVERSE_TARGET_ROW_MISSING");
    if (row.version !== change.aggregateVersion) {
      throw new Error("REVERSE_TARGET_VERSION_MISMATCH");
    }
    return operation(
      change,
      "newsletter_subscribers",
      row.legacyFirestoreId,
      row.version,
      {
        email: row.email,
        status: row.status,
        supabase_id: row.id,
        supabase_version: row.version,
        subscribedAt: row.createdAt,
        ...(row.status === "unsubscribed"
          ? {
              statusReason: "Supabase reverse recovery",
              statusUpdatedAt: row.unsubscribedAt,
              unsubscribedAt: row.unsubscribedAt,
            }
          : {
              statusReason: firestoreDeleteField(),
              statusUpdatedAt: row.updatedAt,
              unsubscribedAt: firestoreDeleteField(),
            }),
        updatedAt: row.updatedAt,
      },
    );
  });
  const keys = operations.map(
    (item) => `${item.collection}:${item.documentId}`,
  );
  if (new Set(keys).size !== keys.length) {
    throw new Error("REVERSE_DOCUMENT_ID_COLLISION");
  }
  const throughSequence = selected.at(-1)?.sequenceId ?? parsed.afterSequence;
  const sourceChanges = pendingChanges.filter(
    (change) => change.sequenceId <= throughSequence,
  ).length;
  return Object.freeze({
    afterSequence: parsed.afterSequence,
    throughSequence,
    complete:
      parsed.sourceExhausted &&
      throughSequence === parsed.sourceHighWaterSequence,
    operations: Object.freeze(operations),
    counts: Object.freeze({
      sourceChanges,
      operations: operations.length,
      customers: operations.filter((item) => item.collection === "customers")
        .length,
      vacations: operations.filter((item) => item.collection === "vacations")
        .length,
      subscribers: operations.filter(
        (item) => item.collection === "newsletter_subscribers",
      ).length,
    }),
  });
}

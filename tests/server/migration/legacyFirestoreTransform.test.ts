import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import type { ScheduleEntryPersistence } from "@/lib/domain/schemas/schedule.ts";
import type { SubscriberPersistence } from "@/lib/domain/schemas/subscribers.ts";
import type { VacationPersistence } from "@/lib/domain/schemas/vacations.ts";
import {
  LegacyFirestoreBatchSchema,
  LegacyFirestoreTransformOptionsSchema,
  transformLegacyFirestoreBatch,
  type LegacyFirestoreBatch,
  type LegacyImportedRecord,
} from "@/lib/server/migration/legacyFirestoreTransform.ts";
import {
  IMPORTED_AT,
  legacyFirestoreFixture,
  legacyTransformOptions,
} from "@/tests/server/migration/fixtures/legacyFirestoreFixtures.ts";

function schedule(
  result: ReturnType<typeof transformLegacyFirestoreBatch>,
  sourceId: string,
): ScheduleEntryPersistence {
  return result.imported.find(
    (item) =>
      item.targetKind === "schedule_entry" && item.sourceRecordId === sourceId,
  )?.record as ScheduleEntryPersistence;
}

function vacation(
  result: ReturnType<typeof transformLegacyFirestoreBatch>,
): VacationPersistence {
  return result.imported.find((item) => item.targetKind === "vacation")
    ?.record as VacationPersistence;
}

function subscribers(
  result: ReturnType<typeof transformLegacyFirestoreBatch>,
): SubscriberPersistence[] {
  return result.imported
    .filter((item) => item.targetKind === "subscriber")
    .map((item) => item.record as SubscriberPersistence);
}

describe("legacy Firestore transform", () => {
  it("preserves every documented calendar-date shape without timezone shifting", () => {
    const result = transformLegacyFirestoreBatch(
      legacyFirestoreFixture(),
      legacyTransformOptions(),
    );

    expect(schedule(result, "appointment-date").date).toBe("2026-01-14");
    expect(schedule(result, "appointment-iso").date).toBe("2026-01-15");
    expect(schedule(result, "appointment-timestamp").date).toBe("2026-01-15");
    expect(vacation(result)).toMatchObject({
      startDate: "2026-01-15",
      endDate: "2026-01-15",
    });
  });

  it("quarantines Timestamp calendar dates until an explicit salon-day resolution exists", () => {
    const options = legacyTransformOptions();
    options.timestampDateResolutions = options.timestampDateResolutions?.filter(
      (item) => item.sourceId !== "appointment-timestamp",
    );
    const result = transformLegacyFirestoreBatch(
      legacyFirestoreFixture(),
      options,
    );

    expect(result.quarantine).toContainEqual(
      expect.objectContaining({
        sourceCollection: "customers",
        sourceRecordId: "appointment-timestamp",
        reasonCode: "UNRESOLVED_TIMESTAMP_DATE",
        fieldCodes: ["SELECTED_DATE"],
      }),
    );
  });

  it("maps catalog identity and recomputes duration/buffer instead of trusting legacy timing", () => {
    const result = transformLegacyFirestoreBatch(
      legacyFirestoreFixture(),
      legacyTransformOptions(),
    );
    const record = schedule(result, "appointment-date");

    expect(record).toMatchObject({
      kind: "appointment",
      serviceId: "manicure",
      variantId: "manicure-30-min",
      serviceNameSnapshot: "Manicure",
      variantNameSnapshot: "Manicure",
      serviceDurationMinutes: 30,
      bufferMinutes: 5,
      startMinutes: 870,
      clientEmail: "maria.rossi@example.com",
      clientPhone: "+393331234567",
    });
  });

  it("accepts the known redundant producer shape after checking redundant clock fields", () => {
    const accepted = transformLegacyFirestoreBatch(
      legacyFirestoreFixture(),
      legacyTransformOptions(),
    );
    expect(schedule(accepted, "appointment-redundant-fields")).toMatchObject({
      kind: "appointment",
      status: "confirmed",
      date: "2026-01-17",
      startMinutes: 570,
      clientPhone: "+393337654321",
      timestampProvenance: "import_time",
    });

    const inconsistent = legacyFirestoreFixture();
    const record = inconsistent.customers.find(
      (item) => item.id === "appointment-redundant-fields",
    );
    if (!record || typeof record.data !== "object" || record.data === null) {
      throw new Error("Fixture is missing the redundant producer record");
    }
    record.data = { ...record.data, timeSlot: "09:45" };
    const rejected = transformLegacyFirestoreBatch(
      inconsistent,
      legacyTransformOptions(),
    );
    expect(rejected.quarantine).toContainEqual(
      expect.objectContaining({
        sourceRecordId: "appointment-redundant-fields",
        reasonCode: "INCONSISTENT_LEGACY_REDUNDANCY",
        fieldCodes: ["START_TIME", "TIME_SLOT"],
      }),
    );
  });

  it("requires explicit occupied duration for legacy fake appointments used as blocks", () => {
    const withMapping = transformLegacyFirestoreBatch(
      legacyFirestoreFixture(),
      legacyTransformOptions(),
    );
    expect(schedule(withMapping, "block-legacy")).toMatchObject({
      kind: "block",
      status: "active",
      serviceDurationMinutes: 90,
      bufferMinutes: 0,
      internalNote: "Formazione sintetica",
    });

    const options = legacyTransformOptions();
    options.blockDurationMappings = [];
    const withoutMapping = transformLegacyFirestoreBatch(
      legacyFirestoreFixture(),
      options,
    );
    expect(withoutMapping.quarantine).toContainEqual(
      expect.objectContaining({
        sourceRecordId: "block-legacy",
        reasonCode: "MISSING_BLOCK_DURATION_MAPPING",
      }),
    );
  });

  it("copies timestamps only for explicitly trusted records and marks fallback provenance", () => {
    const result = transformLegacyFirestoreBatch(
      legacyFirestoreFixture(),
      legacyTransformOptions(),
    );

    expect(schedule(result, "appointment-date")).toMatchObject({
      timestampProvenance: "source",
      createdAt: "2025-11-03T09:12:44.120Z",
      updatedAt: "2025-11-03T10:00:00.000Z",
      importedAt: IMPORTED_AT,
    });
    expect(schedule(result, "appointment-iso")).toMatchObject({
      timestampProvenance: "import_time",
      createdAt: IMPORTED_AT,
      updatedAt: IMPORTED_AT,
    });
  });

  it("keeps unproven legacy subscriptions non-marketable and preserves opt-outs", () => {
    const result = transformLegacyFirestoreBatch(
      legacyFirestoreFixture(),
      legacyTransformOptions(),
    );
    const records = subscribers(result);

    expect(
      records.find((record) => record.email === "newsletter@example.com"),
    ).toMatchObject({
      status: "legacy_unverified",
      consentAt: null,
      consentSource: null,
      confirmedAt: null,
    });
    expect(
      records.find((record) => record.email === "former@example.com"),
    ).toMatchObject({
      status: "unsubscribed",
      unsubscribedAt: "2025-11-03T10:00:00.000Z",
    });
  });

  it("quarantines every case-insensitive subscriber duplicate instead of choosing a winner", () => {
    const batch = legacyFirestoreFixture();
    batch.newsletterSubscribers.push({
      id: "subscriber-duplicate",
      data: { email: "newsletter@example.com", status: "active" },
    });
    const result = transformLegacyFirestoreBatch(
      batch,
      legacyTransformOptions(),
    );

    expect(
      result.quarantine.filter(
        (item) => item.reasonCode === "DUPLICATE_NORMALIZED_EMAIL",
      ),
    ).toEqual([
      expect.objectContaining({ sourceRecordId: "subscriber-active" }),
      expect.objectContaining({ sourceRecordId: "subscriber-duplicate" }),
    ]);
    expect(
      subscribers(result).some(
        (record) => record.email === "newsletter@example.com",
      ),
    ).toBe(false);
  });

  it("returns one imported or quarantined disposition per source ID with redacted anomalies", () => {
    const batch = legacyFirestoreFixture();
    batch.customers.push({
      id: "bad-customer",
      data: {
        name: "PII SHOULD NOT ESCAPE",
        email: "secret@example.com",
        appointmentType: "Unknown secret service",
        selectedDate: "2026-01-20",
        startTime: "10:00",
        note: "sensitive note",
      },
    });
    const result = transformLegacyFirestoreBatch(
      batch,
      legacyTransformOptions(),
    );
    const anomaly = result.quarantine.find(
      (item) => item.sourceRecordId === "bad-customer",
    );

    expect(result.counts.source).toBe(
      result.counts.imported + result.counts.quarantined,
    );
    expect(anomaly).toMatchObject({
      reasonCode: "UNMAPPED_CATALOG",
      fieldCodes: ["APPOINTMENT_TYPE"],
    });
    expect(JSON.stringify(anomaly)).not.toMatch(
      /PII SHOULD NOT ESCAPE|secret@example|sensitive note|Unknown secret/i,
    );
  });

  it("is deterministic across reruns and source-array ordering", () => {
    const firstBatch = legacyFirestoreFixture();
    const reorderedBatch = legacyFirestoreFixture();
    reorderedBatch.customers.reverse();
    reorderedBatch.newsletterSubscribers.reverse();

    const first = transformLegacyFirestoreBatch(
      firstBatch,
      legacyTransformOptions(),
    );
    const second = transformLegacyFirestoreBatch(
      reorderedBatch,
      legacyTransformOptions(),
    );

    expect(second).toEqual(first);
    expect(
      first.imported.every(
        (item) =>
          item.targetId ===
          (
            item.record as LegacyImportedRecord<unknown>["record"] & {
              id: string;
            }
          ).id,
      ),
    ).toBe(true);
  });

  it("enforces strict, unique and bounded batch/mapping schemas", () => {
    const duplicateBatch = legacyFirestoreFixture();
    duplicateBatch.customers.push(duplicateBatch.customers[0]!);
    expect(() => LegacyFirestoreBatchSchema.parse(duplicateBatch)).toThrow();

    const unknownBatch = {
      ...legacyFirestoreFixture(),
      productionProject: "must-not-be-accepted",
    };
    expect(() => LegacyFirestoreBatchSchema.parse(unknownBatch)).toThrow();

    const overLimit = {
      importedAt: IMPORTED_AT,
      customers: Array.from({ length: 1_667 }, (_, index) => ({
        id: `customer-${index}`,
        data: null,
      })),
      vacations: Array.from({ length: 1_667 }, (_, index) => ({
        id: `vacation-${index}`,
        data: null,
      })),
      newsletterSubscribers: Array.from({ length: 1_667 }, (_, index) => ({
        id: `subscriber-${index}`,
        data: null,
      })),
    } satisfies LegacyFirestoreBatch;
    expect(() => LegacyFirestoreBatchSchema.parse(overLimit)).toThrow();

    expect(() =>
      LegacyFirestoreTransformOptionsSchema.parse({
        blockDurationMappings: [
          { sourceId: "same", serviceDurationMinutes: 30 },
          { sourceId: "same", serviceDurationMinutes: 60 },
        ],
      }),
    ).toThrow();
  });

  it("does not log source records or transformed PII", () => {
    const log = vi.spyOn(console, "log");
    const warn = vi.spyOn(console, "warn");
    const error = vi.spyOn(console, "error");

    transformLegacyFirestoreBatch(
      legacyFirestoreFixture(),
      legacyTransformOptions(),
    );

    expect(log).not.toHaveBeenCalled();
    expect(warn).not.toHaveBeenCalled();
    expect(error).not.toHaveBeenCalled();
  });
});

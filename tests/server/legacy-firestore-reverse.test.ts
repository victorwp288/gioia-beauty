import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { compileLegacyFirestoreReversePlan } from "@/lib/server/migration/legacyFirestoreReverse.ts";

const instant = "2026-07-20T12:00:00.000Z";
const appointmentId = "10000000-0000-4000-8000-000000000001";
const blockId = "10000000-0000-4000-8000-000000000002";
const vacationId = "10000000-0000-4000-8000-000000000003";
const subscriberId = "10000000-0000-4000-8000-000000000004";

function fixture() {
  return {
    afterSequence: 0,
    sourceHighWaterSequence: 5,
    sourceExhausted: true,
    limit: 50,
    changes: [
      {
        sequenceId: 1,
        aggregateKind: "schedule_entry",
        aggregateId: appointmentId,
        aggregateVersion: 1,
        changeKind: "create",
      },
      {
        sequenceId: 2,
        aggregateKind: "schedule_entry",
        aggregateId: appointmentId,
        aggregateVersion: 2,
        changeKind: "reschedule",
      },
      {
        sequenceId: 3,
        aggregateKind: "schedule_entry",
        aggregateId: blockId,
        aggregateVersion: 1,
        changeKind: "block",
      },
      {
        sequenceId: 4,
        aggregateKind: "vacation",
        aggregateId: vacationId,
        aggregateVersion: 2,
        changeKind: "cancel",
      },
      {
        sequenceId: 5,
        aggregateKind: "subscriber",
        aggregateId: subscriberId,
        aggregateVersion: 2,
        changeKind: "unsubscribe",
      },
    ],
    scheduleEntries: [
      {
        id: appointmentId,
        legacyFirestoreId: "legacy-appointment",
        kind: "appointment",
        status: "confirmed",
        localDate: "2026-08-10",
        startMinutes: 600,
        serviceDurationMinutes: 45,
        bufferMinutes: 5,
        serviceNameSnapshot: "Manicure",
        variantNameSnapshot: "45 minuti",
        clientName: "Cliente Sintetico",
        clientEmail: "cliente@example.test",
        clientPhone: "+390000000000",
        clientNote: "nota sintetica",
        internalNote: null,
        cancelledAt: null,
        cancellationReason: null,
        version: 2,
        createdAt: instant,
        updatedAt: instant,
      },
      {
        id: blockId,
        legacyFirestoreId: null,
        kind: "block",
        status: "cancelled",
        localDate: "2026-08-10",
        startMinutes: 720,
        serviceDurationMinutes: 30,
        bufferMinutes: 0,
        serviceNameSnapshot: null,
        variantNameSnapshot: null,
        clientName: null,
        clientEmail: null,
        clientPhone: null,
        clientNote: null,
        internalNote: "pausa sintetica",
        cancelledAt: instant,
        cancellationReason: "synthetic cleanup",
        version: 1,
        createdAt: instant,
        updatedAt: instant,
      },
    ],
    vacations: [
      {
        id: vacationId,
        legacyFirestoreId: "legacy-vacation",
        startDate: "2026-08-20",
        endDate: "2026-08-21",
        status: "cancelled",
        reason: null,
        cancelledAt: instant,
        version: 2,
        createdAt: instant,
        updatedAt: instant,
      },
    ],
    subscribers: [
      {
        id: subscriberId,
        legacyFirestoreId: null,
        email: "subscriber@example.test",
        status: "unsubscribed",
        unsubscribedAt: instant,
        version: 2,
        createdAt: instant,
        updatedAt: instant,
      },
    ],
  };
}

describe("legacy Firestore reverse plan", () => {
  it("coalesces change history and preserves legacy or deterministic IDs", () => {
    const plan = compileLegacyFirestoreReversePlan(fixture());
    expect(plan).toMatchObject({
      afterSequence: 0,
      throughSequence: 5,
      complete: true,
      counts: {
        sourceChanges: 5,
        operations: 4,
        customers: 2,
        vacations: 1,
        subscribers: 1,
      },
    });
    expect(plan.operations.map((item) => item.documentId)).toEqual([
      "legacy-appointment",
      `supabase_${blockId}`,
      "legacy-vacation",
      `supabase_${subscriberId}`,
    ]);
    expect(plan.operations[0]?.payload).toMatchObject({
      selectedDate: {
        valueType: "firestore_timestamp",
        seconds: 1_786_312_800,
        nanoseconds: 0,
      },
      startTime: "10:00",
      endTime: "10:50",
      duration: 45,
      totalDuration: 50,
      variant: "45",
      isTimeBlock: false,
      supabase_id: appointmentId,
    });
    expect(plan.operations[1]).toMatchObject({
      action: "delete",
      collection: "customers",
      payload: null,
    });
    expect(plan.operations[2]).toMatchObject({
      action: "delete",
      collection: "vacations",
      payload: null,
    });
    expect(plan.operations[3]?.payload).toMatchObject({
      status: "unsubscribed",
      unsubscribedAt: instant,
      statusUpdatedAt: instant,
    });
  });

  it("is byte-stable on rerun and advances a bounded high-water window", () => {
    const input = fixture();
    const first = compileLegacyFirestoreReversePlan({ ...input, limit: 1 });
    const replay = compileLegacyFirestoreReversePlan({ ...input, limit: 1 });
    expect(replay).toEqual(first);
    expect(first).toMatchObject({ throughSequence: 2, complete: false });
    expect(first.operations).toHaveLength(1);
    expect(first.operations[0]?.sourceSequenceId).toBe(2);
    const second = compileLegacyFirestoreReversePlan({
      ...input,
      afterSequence: first.throughSequence,
      limit: 2,
    });
    expect(second.throughSequence).toBe(4);
    expect(second.operations).toHaveLength(2);
  });

  it("requires authoritative exhaustion at the captured source high-water", () => {
    const input = fixture();
    expect(
      compileLegacyFirestoreReversePlan({
        ...input,
        sourceHighWaterSequence: 6,
        sourceExhausted: false,
      }).complete,
    ).toBe(false);
    expect(() =>
      compileLegacyFirestoreReversePlan({
        ...input,
        sourceHighWaterSequence: 6,
        sourceExhausted: true,
      }),
    ).toThrow();
    expect(
      compileLegacyFirestoreReversePlan({
        ...input,
        changes: input.changes.filter((change) => change.sequenceId !== 3),
      }),
    ).toMatchObject({ complete: true, throughSequence: 5 });
  });

  it("deletes stale unsubscribe fields when an existing legacy row resubscribes", () => {
    const input = fixture();
    const plan = compileLegacyFirestoreReversePlan({
      ...input,
      afterSequence: 4,
      changes: [input.changes[4]!],
      subscribers: input.subscribers.map((row) => ({
        ...row,
        status: "active" as const,
        unsubscribedAt: null,
      })),
    });
    const payload = plan.operations[0]?.payload;
    const legacy = {
      statusReason: "User request",
      statusUpdatedAt: "2026-07-19T12:00:00.000Z",
      unsubscribedAt: "2026-07-19T12:00:00.000Z",
    } as Record<string, unknown>;
    for (const [key, value] of Object.entries(payload ?? {})) {
      if (
        typeof value === "object" &&
        value !== null &&
        "valueType" in value &&
        value.valueType === "firestore_delete_field"
      ) {
        delete legacy[key];
      } else {
        legacy[key] = value;
      }
    }
    expect(legacy).toMatchObject({
      status: "active",
      statusUpdatedAt: instant,
    });
    expect(legacy).not.toHaveProperty("statusReason");
    expect(legacy).not.toHaveProperty("unsubscribedAt");
  });

  it("uses active legacy shapes for blocks and vacation dates", () => {
    const input = fixture();
    const plan = compileLegacyFirestoreReversePlan({
      ...input,
      afterSequence: 2,
      sourceHighWaterSequence: 4,
      changes: [input.changes[2]!, input.changes[3]!],
      scheduleEntries: input.scheduleEntries.map((row) =>
        row.id === blockId
          ? {
              ...row,
              status: "active",
              cancelledAt: null,
              cancellationReason: null,
            }
          : row,
      ),
      vacations: input.vacations.map((row) => ({
        ...row,
        status: "active",
        cancelledAt: null,
      })),
    });

    expect(plan.operations[0]?.payload).toMatchObject({
      name: "Blocco Orario",
      appointmentType: "Blocco Orario",
      status: "confirmed",
      isTimeBlock: true,
    });
    expect(plan.operations[1]?.payload).toMatchObject({
      startDate: "2026-08-20T00:00:00.000Z",
      endDate: "2026-08-21T00:00:00.000Z",
      status: "active",
    });
  });

  it("fails closed on missing canonical rows and document collisions", () => {
    const input = fixture();
    expect(() =>
      compileLegacyFirestoreReversePlan({ ...input, vacations: [] }),
    ).toThrow("REVERSE_TARGET_ROW_MISSING");
    expect(() =>
      compileLegacyFirestoreReversePlan({
        ...input,
        scheduleEntries: input.scheduleEntries.map((row) => ({
          ...row,
          legacyFirestoreId: "duplicate",
        })),
      }),
    ).toThrow("REVERSE_DOCUMENT_ID_COLLISION");
  });

  it("fails closed on an inconsistent row snapshot or invalid kind shape", () => {
    const input = fixture();
    expect(() =>
      compileLegacyFirestoreReversePlan({
        ...input,
        sourceHighWaterSequence: 1,
        changes: input.changes.slice(0, 1),
      }),
    ).toThrow("REVERSE_TARGET_VERSION_MISMATCH");
    expect(() =>
      compileLegacyFirestoreReversePlan({
        ...input,
        scheduleEntries: input.scheduleEntries.map((row) =>
          row.id === blockId ? { ...row, clientName: "not a block" } : row,
        ),
      }),
    ).toThrow();
    expect(() =>
      compileLegacyFirestoreReversePlan({
        ...input,
        scheduleEntries: input.scheduleEntries.map((row) =>
          row.id === appointmentId
            ? { ...row, startMinutes: 1_439, serviceDurationMinutes: 2 }
            : row,
        ),
      }),
    ).toThrow();
  });
});

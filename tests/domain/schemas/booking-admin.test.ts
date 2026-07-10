import { describe, expect, it } from "vitest";

import {
  AdminCancelScheduleEntryCommandSchema,
  AdminCreateAppointmentCommandSchema,
  AdminCreateBlockCommandSchema,
  AdminCreateVacationCommandSchema,
  AdminRescheduleAppointmentCommandSchema,
  AdminRescheduleBlockCommandSchema,
  AdminRetryOutboxBodySchema,
  AdminRetryOutboxCommandSchema,
  AdminSetAppointmentStatusCommandSchema,
  AdminUpdateAppointmentCommandSchema,
  AdminUpdateBlockCommandSchema,
  PublicCancelAppointmentCommandSchema,
  PublicBookingCommandSchema,
} from "@/lib/domain/schemas/index.ts";

const IDEMPOTENCY_KEY = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const ENTRY_ID = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";

const PUBLIC_BOOKING = {
  idempotencyKey: IDEMPOTENCY_KEY,
  date: "2026-08-10",
  startMinutes: 600,
  serviceId: "massaggio-relax",
  variantId: "massaggio-relax-60",
  clientName: " Maria Rossi ",
  clientEmail: " MARIA@example.com ",
  clientPhone: "+39 333 123 4567",
  clientNote: "  Prima visita  ",
};

describe("public booking command", () => {
  it("normalizes the complete allowed request", () => {
    expect(PublicBookingCommandSchema.parse(PUBLIC_BOOKING)).toEqual({
      ...PUBLIC_BOOKING,
      clientName: "Maria Rossi",
      clientEmail: "maria@example.com",
      clientPhone: "+393331234567",
      clientNote: "Prima visita",
    });
  });

  it("rejects every client-controlled derived field and any unknown key", () => {
    for (const [field, value] of Object.entries({
      durationMinutes: 60,
      serviceDurationMinutes: 60,
      bufferMinutes: 15,
      endMinutes: 675,
      endTime: "11:15",
      status: "confirmed",
      priceCents: 5000,
      currency: "EUR",
      requestFingerprint: "a".repeat(64),
    })) {
      expect(
        PublicBookingCommandSchema.safeParse({
          ...PUBLIC_BOOKING,
          [field]: value,
        }).success,
        field,
      ).toBe(false);
    }
  });

  it("rejects malformed dates, minutes, catalog IDs, and idempotency keys", () => {
    for (const patch of [
      { date: "2026-02-30" },
      { startMinutes: 1440 },
      { startMinutes: 600.5 },
      { serviceId: "Massaggio Relax" },
      { variantId: "../variant" },
      { idempotencyKey: "retry-me" },
    ]) {
      expect(
        PublicBookingCommandSchema.safeParse({ ...PUBLIC_BOOKING, ...patch })
          .success,
      ).toBe(false);
    }
  });
});

describe("admin schedule commands", () => {
  it("keeps appointment creation server-derived while allowing absent contacts", () => {
    const command = {
      idempotencyKey: IDEMPOTENCY_KEY,
      date: "2026-08-10",
      startMinutes: 600,
      serviceId: "massaggio-relax",
      variantId: "massaggio-relax-60",
      clientName: "Cliente senza email",
      clientEmail: null,
      clientPhone: null,
    };
    expect(AdminCreateAppointmentCommandSchema.parse(command)).toEqual({
      ...command,
      clientNote: null,
    });
    expect(
      AdminCreateAppointmentCommandSchema.safeParse({
        ...command,
        status: "confirmed",
      }).success,
    ).toBe(false);
  });

  it("bounds block duration, buffer, and salon-local end", () => {
    const block = {
      idempotencyKey: IDEMPOTENCY_KEY,
      date: "2026-08-10",
      startMinutes: 1380,
      durationMinutes: 45,
      internalNote: "Chiusura anticipata",
    };
    expect(AdminCreateBlockCommandSchema.parse(block)).toMatchObject({
      ...block,
      bufferMinutes: 0,
    });
    expect(
      AdminCreateBlockCommandSchema.safeParse({
        ...block,
        durationMinutes: 61,
      }).success,
    ).toBe(false);
  });

  it("separates appointment and block rescheduling", () => {
    const base = {
      idempotencyKey: IDEMPOTENCY_KEY,
      entryId: ENTRY_ID,
      expectedVersion: 2,
      date: "2026-08-11",
      startMinutes: 660,
    };
    expect(
      AdminRescheduleAppointmentCommandSchema.safeParse({
        ...base,
        serviceId: "massaggio-relax",
        variantId: "massaggio-relax-60",
      }).success,
    ).toBe(true);
    expect(
      AdminRescheduleAppointmentCommandSchema.safeParse({
        ...base,
        serviceId: "massaggio-relax",
        variantId: "massaggio-relax-60",
        durationMinutes: 60,
      }).success,
    ).toBe(false);
    expect(
      AdminRescheduleBlockCommandSchema.safeParse({
        ...base,
        durationMinutes: 60,
        bufferMinutes: 0,
      }).success,
    ).toBe(true);
  });

  it("keeps detail edits separate from occupancy-changing commands", () => {
    const versionFields = {
      idempotencyKey: IDEMPOTENCY_KEY,
      entryId: ENTRY_ID,
      expectedVersion: 2,
    };
    expect(
      AdminUpdateAppointmentCommandSchema.safeParse({
        ...versionFields,
        clientName: "Maria Rossi",
        clientEmail: null,
        clientPhone: null,
        clientNote: "Nuovo recapito richiesto",
      }).success,
    ).toBe(true);
    expect(
      AdminUpdateAppointmentCommandSchema.safeParse({
        ...versionFields,
        clientName: "Maria Rossi",
        clientEmail: null,
        clientPhone: null,
        durationMinutes: 90,
      }).success,
    ).toBe(false);
    expect(
      AdminUpdateBlockCommandSchema.safeParse({
        ...versionFields,
        internalNote: "Riunione",
      }).success,
    ).toBe(true);
    const partial = AdminUpdateAppointmentCommandSchema.parse({
      ...versionFields,
      clientName: "Solo nome aggiornato",
    });
    expect(partial).not.toHaveProperty("clientNote");
    expect(
      AdminUpdateAppointmentCommandSchema.parse({
        ...versionFields,
        internalNote: "Promemoria proprietaria",
      }).internalNote,
    ).toBe("Promemoria proprietaria");
    expect(AdminUpdateBlockCommandSchema.safeParse(versionFields).success).toBe(
      false,
    );
    expect(
      AdminUpdateBlockCommandSchema.parse({
        ...versionFields,
        internalNote: null,
      }).internalNote,
    ).toBeNull();
  });

  it("uses separate cancellation and non-cancel status commands", () => {
    expect(
      AdminCancelScheduleEntryCommandSchema.parse({
        idempotencyKey: IDEMPOTENCY_KEY,
        entryId: ENTRY_ID,
        expectedVersion: 2,
        reason: "  Richiesta cliente  ",
      }).reason,
    ).toBe("Richiesta cliente");
    expect(
      AdminSetAppointmentStatusCommandSchema.safeParse({
        idempotencyKey: IDEMPOTENCY_KEY,
        entryId: ENTRY_ID,
        expectedVersion: 2,
        status: "cancelled",
      }).success,
    ).toBe(false);
    expect(
      AdminSetAppointmentStatusCommandSchema.safeParse({
        idempotencyKey: IDEMPOTENCY_KEY,
        entryId: ENTRY_ID,
        expectedVersion: 2,
        status: "confirmed",
      }).success,
    ).toBe(false);
  });

  it("accepts inclusive vacations up to 366 days and rejects reversed ranges", () => {
    expect(
      AdminCreateVacationCommandSchema.safeParse({
        idempotencyKey: IDEMPOTENCY_KEY,
        startDate: "2028-01-01",
        endDate: "2028-12-31",
        reason: "Chiusura",
      }).success,
    ).toBe(true);
    expect(
      AdminCreateVacationCommandSchema.safeParse({
        idempotencyKey: IDEMPOTENCY_KEY,
        startDate: "2028-05-02",
        endDate: "2028-05-01",
      }).success,
    ).toBe(false);
  });

  it("requires signed customer cancellation and versioned outbox retry", () => {
    const token = `${"a".repeat(20)}.${"b".repeat(20)}.${"c".repeat(20)}`;
    expect(
      PublicCancelAppointmentCommandSchema.safeParse({
        idempotencyKey: IDEMPOTENCY_KEY,
        token,
      }).success,
    ).toBe(true);
    expect(
      PublicCancelAppointmentCommandSchema.safeParse({
        idempotencyKey: IDEMPOTENCY_KEY,
        entryId: ENTRY_ID,
      }).success,
    ).toBe(false);
    expect(
      AdminRetryOutboxCommandSchema.safeParse({
        idempotencyKey: IDEMPOTENCY_KEY,
        outboxId: ENTRY_ID,
        expectedVersion: 2,
      }).success,
    ).toBe(true);
    expect(
      AdminRetryOutboxBodySchema.parse({
        outboxId: ENTRY_ID.toUpperCase(),
        expectedVersion: 2_147_483_647,
      }),
    ).toEqual({ outboxId: ENTRY_ID, expectedVersion: 2_147_483_647 });
    for (const candidate of [
      { outboxId: ENTRY_ID, expectedVersion: 0 },
      { outboxId: ENTRY_ID, expectedVersion: 2_147_483_648 },
      {
        outboxId: ENTRY_ID,
        expectedVersion: 2,
        idempotencyKey: IDEMPOTENCY_KEY,
      },
      { outboxId: ENTRY_ID, expectedVersion: 2, extra: true },
    ]) {
      expect(AdminRetryOutboxBodySchema.safeParse(candidate).success).toBe(
        false,
      );
    }
  });
});

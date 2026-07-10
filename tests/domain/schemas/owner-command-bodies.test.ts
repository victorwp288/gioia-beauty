import { describe, expect, it } from "vitest";

import {
  AdminCancelScheduleEntryBodySchema,
  AdminCancelScheduleEntryCommandSchema,
  AdminCancelVacationBodySchema,
  AdminCancelVacationCommandSchema,
  AdminCreateAppointmentBodySchema,
  AdminCreateAppointmentCommandSchema,
  AdminCreateBlockBodySchema,
  AdminCreateBlockCommandSchema,
  AdminCreateVacationBodySchema,
  AdminCreateVacationCommandSchema,
  AdminRescheduleAppointmentBodySchema,
  AdminRescheduleAppointmentCommandSchema,
  AdminRescheduleBlockBodySchema,
  AdminRescheduleBlockCommandSchema,
  AdminSetAppointmentStatusBodySchema,
  AdminSetAppointmentStatusCommandSchema,
  AdminUpdateAppointmentBodySchema,
  AdminUpdateAppointmentCommandSchema,
  AdminUpdateBlockBodySchema,
  AdminUpdateBlockCommandSchema,
} from "@/lib/domain/schemas/index.ts";

const IDEMPOTENCY_KEY = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const RESOURCE_ID = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";

const cases = [
  {
    name: "appointment create",
    bodySchema: AdminCreateAppointmentBodySchema,
    commandSchema: AdminCreateAppointmentCommandSchema,
    body: {
      date: "2026-08-10",
      startMinutes: 600,
      serviceId: "massaggio-relax",
      variantId: "massaggio-relax-60",
      clientName: " Maria Rossi ",
      clientEmail: " MARIA@example.com ",
      clientPhone: "+39 333 123 4567",
    },
  },
  {
    name: "appointment update",
    bodySchema: AdminUpdateAppointmentBodySchema,
    commandSchema: AdminUpdateAppointmentCommandSchema,
    body: {
      entryId: RESOURCE_ID.toUpperCase(),
      expectedVersion: 2,
      clientEmail: " MARIA@example.com ",
      clientPhone: "+39 333 123 4567",
      clientNote: " Nuova nota ",
    },
  },
  {
    name: "block create",
    bodySchema: AdminCreateBlockBodySchema,
    commandSchema: AdminCreateBlockCommandSchema,
    body: {
      date: "2026-08-10",
      startMinutes: 600,
      durationMinutes: 60,
    },
  },
  {
    name: "block update",
    bodySchema: AdminUpdateBlockBodySchema,
    commandSchema: AdminUpdateBlockCommandSchema,
    body: {
      entryId: RESOURCE_ID.toUpperCase(),
      expectedVersion: 2,
      internalNote: " Pausa aggiornata ",
    },
  },
  {
    name: "appointment reschedule",
    bodySchema: AdminRescheduleAppointmentBodySchema,
    commandSchema: AdminRescheduleAppointmentCommandSchema,
    body: {
      entryId: RESOURCE_ID.toUpperCase(),
      expectedVersion: 2,
      date: "2026-08-11",
      startMinutes: 660,
      serviceId: "massaggio-relax",
      variantId: "massaggio-relax-60",
    },
  },
  {
    name: "block reschedule",
    bodySchema: AdminRescheduleBlockBodySchema,
    commandSchema: AdminRescheduleBlockCommandSchema,
    body: {
      entryId: RESOURCE_ID.toUpperCase(),
      expectedVersion: 2,
      date: "2026-08-11",
      startMinutes: 660,
      durationMinutes: 60,
    },
  },
  {
    name: "schedule cancellation",
    bodySchema: AdminCancelScheduleEntryBodySchema,
    commandSchema: AdminCancelScheduleEntryCommandSchema,
    body: { entryId: RESOURCE_ID, expectedVersion: 2 },
  },
  {
    name: "appointment status",
    bodySchema: AdminSetAppointmentStatusBodySchema,
    commandSchema: AdminSetAppointmentStatusCommandSchema,
    body: {
      entryId: RESOURCE_ID.toUpperCase(),
      expectedVersion: 2,
      status: "completed",
    },
  },
  {
    name: "vacation create",
    bodySchema: AdminCreateVacationBodySchema,
    commandSchema: AdminCreateVacationCommandSchema,
    body: { startDate: "2026-08-10", endDate: "2026-08-12" },
  },
  {
    name: "vacation cancellation",
    bodySchema: AdminCancelVacationBodySchema,
    commandSchema: AdminCancelVacationCommandSchema,
    body: { vacationId: RESOURCE_ID, expectedVersion: 2 },
  },
] as const;

describe("owner command body schemas", () => {
  for (const testCase of cases) {
    it(`normalizes ${testCase.name} identically to its command schema`, () => {
      const normalizedBody = testCase.bodySchema.parse(testCase.body);
      expect(
        testCase.commandSchema.parse({
          ...testCase.body,
          idempotencyKey: IDEMPOTENCY_KEY,
        }),
      ).toEqual({ ...normalizedBody, idempotencyKey: IDEMPOTENCY_KEY });
      for (const [field, value] of Object.entries({
        idempotencyKey: IDEMPOTENCY_KEY,
        csrfToken: "A".repeat(43),
        identity: { userId: RESOURCE_ID },
      })) {
        expect(
          testCase.bodySchema.safeParse({
            ...testCase.body,
            [field]: value,
          }).success,
          `${testCase.name}:${field}`,
        ).toBe(false);
      }
    });
  }

  it("keeps refined block and vacation constraints on body schemas", () => {
    expect(
      AdminCreateBlockBodySchema.safeParse({
        date: "2026-08-10",
        startMinutes: 1_395,
        durationMinutes: 60,
      }).success,
    ).toBe(false);
    expect(
      AdminRescheduleBlockBodySchema.safeParse({
        entryId: RESOURCE_ID,
        expectedVersion: 2,
        date: "2026-08-10",
        startMinutes: 1_395,
        durationMinutes: 60,
      }).success,
    ).toBe(false);
    expect(
      AdminCreateVacationBodySchema.safeParse({
        startDate: "2026-08-11",
        endDate: "2026-08-10",
      }).success,
    ).toBe(false);
  });

  it("requires a real appointment or block details patch", () => {
    for (const schema of [
      AdminUpdateAppointmentBodySchema,
      AdminUpdateBlockBodySchema,
    ]) {
      expect(
        schema.safeParse({ entryId: RESOURCE_ID, expectedVersion: 2 }).success,
      ).toBe(false);
    }
    for (const schema of [
      AdminUpdateAppointmentCommandSchema,
      AdminUpdateBlockCommandSchema,
    ]) {
      expect(
        schema.safeParse({
          idempotencyKey: IDEMPOTENCY_KEY,
          entryId: RESOURCE_ID,
          expectedVersion: 2,
        }).success,
      ).toBe(false);
    }
  });
});

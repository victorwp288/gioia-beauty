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
    name: "schedule cancellation",
    bodySchema: AdminCancelScheduleEntryBodySchema,
    commandSchema: AdminCancelScheduleEntryCommandSchema,
    body: { entryId: RESOURCE_ID, expectedVersion: 2 },
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
      expect(
        testCase.bodySchema.safeParse({
          ...testCase.body,
          idempotencyKey: IDEMPOTENCY_KEY,
        }).success,
      ).toBe(false);
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
      AdminCreateVacationBodySchema.safeParse({
        startDate: "2026-08-11",
        endDate: "2026-08-10",
      }).success,
    ).toBe(false);
  });
});

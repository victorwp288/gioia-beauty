import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { createOwnerScheduleRepository } from "@/lib/server/database/ownerScheduleRepository.ts";
import type {
  RuntimeDatabase,
  RuntimeTransaction,
} from "@/lib/server/database/runtime.ts";

const identity = {
  userId: "10000000-0000-4000-8000-000000000001",
  sessionId: "20000000-0000-4000-8000-000000000001",
};
const fingerprint = Buffer.alloc(32, 7);
const idempotencyKey = "30000000-0000-4000-8000-000000000001";
const resourceId = "40000000-0000-4000-8000-000000000001";
const appointment = {
  idempotencyKey,
  date: "2026-08-10",
  startMinutes: 600,
  serviceId: "massaggio-relax",
  variantId: "massaggio-relax-60",
  clientName: "Cliente Test",
  clientEmail: null,
  clientPhone: null,
};
const scheduleCancellation = {
  idempotencyKey,
  entryId: resourceId,
  expectedVersion: 2,
};
const vacationCancellation = {
  idempotencyKey,
  vacationId: resourceId,
  expectedVersion: 2,
};

function success(status: 200 | 201, code: string) {
  return {
    http_status: status,
    result: { code, resource_id: resourceId },
    replayed: false,
  };
}

function repositoryWith(rows: Array<Record<string, unknown>>) {
  const unsafe = vi.fn<RuntimeTransaction["unsafe"]>(async () => rows);
  return createOwnerScheduleRepository({
    ownerTransaction: vi.fn(async (_identity, work) =>
      work({ unsafe } as RuntimeTransaction),
    ) as RuntimeDatabase["ownerTransaction"],
  });
}

describe("owner schedule repository result contracts", () => {
  it("rejects cross-operation and mismatched failure contracts", async () => {
    for (const row of [
      {
        http_status: 409,
        result: { code: "VACATION_NOT_FOUND" },
        replayed: false,
      },
      {
        http_status: 404,
        result: { code: "VERSION_CONFLICT" },
        replayed: false,
      },
      {
        http_status: 404,
        result: { code: "APPOINTMENT_CONTACT_INVALID" },
        replayed: false,
      },
    ]) {
      await expect(
        repositoryWith([row]).createAppointment(
          identity,
          appointment,
          fingerprint,
        ),
      ).rejects.toThrow("Unexpected owner command result");
    }
  });

  it("requires cancellation success to identify the requested resource", async () => {
    const wrongResource = "50000000-0000-4000-8000-000000000001";
    await expect(
      repositoryWith([
        {
          ...success(200, "SCHEDULE_ENTRY_CANCELLED"),
          result: {
            code: "SCHEDULE_ENTRY_CANCELLED",
            resource_id: wrongResource,
          },
        },
      ]).cancelScheduleEntry(identity, scheduleCancellation, fingerprint),
    ).rejects.toThrow("Unexpected owner command result");
    await expect(
      repositoryWith([
        {
          ...success(200, "VACATION_CANCELLED"),
          result: { code: "VACATION_CANCELLED", resource_id: wrongResource },
        },
      ]).cancelVacation(identity, vacationCancellation, fingerprint),
    ).rejects.toThrow("Unexpected owner command result");
  });

  it("rejects missing, duplicate, malformed, and extra command rows", async () => {
    const valid = success(201, "APPOINTMENT_CREATED");
    for (const rows of [
      [],
      [valid, valid],
      [{ ...valid, extra: true }],
      [{ ...valid, result: { ...valid.result, extra: true } }],
      [{ ...valid, result: { ...valid.result, resource_id: "not-a-uuid" } }],
    ]) {
      await expect(
        repositoryWith(rows).createAppointment(
          identity,
          appointment,
          fingerprint,
        ),
      ).rejects.toThrow("Unexpected owner command result");
    }
  });

  it("enforces the exact appointment success contract", async () => {
    for (const row of [
      success(200, "APPOINTMENT_CREATED"),
      success(201, "BLOCK_CREATED"),
      {
        http_status: 201,
        result: { code: "APPOINTMENT_CREATED" },
        replayed: false,
      },
      {
        http_status: 409,
        result: { code: "SLOT_UNAVAILABLE", resource_id: resourceId },
        replayed: false,
      },
      {
        http_status: 500,
        result: { code: "SERVICE_UNAVAILABLE" },
        replayed: false,
      },
    ]) {
      await expect(
        repositoryWith([row]).createAppointment(
          identity,
          appointment,
          fingerprint,
        ),
      ).rejects.toThrow("Unexpected owner command result");
    }
  });
});

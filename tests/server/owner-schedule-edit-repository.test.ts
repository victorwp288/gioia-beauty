import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { OWNER_SCHEDULE_COMMAND_CONTRACTS } from "@/lib/server/database/ownerScheduleCommandContracts.ts";
import type { OwnerScheduleEditMethodName } from "@/lib/server/database/ownerScheduleEditRepository.ts";
import {
  createOwnerScheduleRepository,
  type OwnerScheduleCommandResult,
} from "@/lib/server/database/ownerScheduleRepository.ts";
import type {
  RuntimeDatabase,
  RuntimeTransaction,
} from "@/lib/server/database/runtime.ts";

const identity = {
  userId: "10000000-0000-4000-8000-000000000001",
  sessionId: "20000000-0000-4000-8000-000000000001",
};
const fingerprint = Buffer.alloc(32, 9);
const idempotencyKey = "30000000-0000-4000-8000-000000000001";
const resourceId = "40000000-0000-4000-8000-000000000001";
const otherResourceId = "50000000-0000-4000-8000-000000000001";

function result(
  httpStatus: number,
  code: string,
  resource = resourceId,
): Record<string, unknown> {
  return {
    http_status: httpStatus,
    result: resource ? { code, resource_id: resource } : { code },
    replayed: false,
  };
}

function setup(rows: Array<Record<string, unknown>>) {
  const unsafe = vi.fn<RuntimeTransaction["unsafe"]>(async () => rows);
  const ownerTransaction = vi.fn(
    async (
      context: typeof identity,
      work: (transaction: RuntimeTransaction) => unknown,
    ) => {
      expect(context).toEqual(identity);
      return work({ unsafe } as RuntimeTransaction);
    },
  );
  return {
    repository: createOwnerScheduleRepository({
      ownerTransaction: ownerTransaction as RuntimeDatabase["ownerTransaction"],
    }),
    ownerTransaction,
    unsafe,
  };
}

interface EditCase {
  method: OwnerScheduleEditMethodName;
  code: string;
  command: Record<string, unknown>;
  parameters: readonly unknown[];
}

const editCases: readonly EditCase[] = [
  {
    method: "updateAppointment",
    code: "APPOINTMENT_DETAILS_UPDATED",
    command: {
      idempotencyKey,
      entryId: resourceId,
      expectedVersion: 2,
      clientName: " Cliente Test ",
      clientEmail: null,
      internalNote: " ",
    },
    parameters: [
      identity.userId,
      idempotencyKey,
      fingerprint,
      resourceId,
      2,
      JSON.stringify({
        client_name: "Cliente Test",
        client_email: null,
        internal_note: null,
      }),
    ],
  },
  {
    method: "updateBlock",
    code: "BLOCK_DETAILS_UPDATED",
    command: {
      idempotencyKey,
      entryId: resourceId,
      expectedVersion: 3,
      internalNote: " Pausa ",
    },
    parameters: [
      identity.userId,
      idempotencyKey,
      fingerprint,
      resourceId,
      3,
      "Pausa",
    ],
  },
  {
    method: "rescheduleAppointment",
    code: "APPOINTMENT_RESCHEDULED",
    command: {
      idempotencyKey,
      entryId: resourceId,
      expectedVersion: 4,
      date: "2035-02-05",
      startMinutes: 600,
      serviceId: "massaggio-relax",
      variantId: "massaggio-relax-60",
    },
    parameters: [
      identity.userId,
      idempotencyKey,
      fingerprint,
      resourceId,
      4,
      "2035-02-05",
      600,
      "massaggio-relax",
      "massaggio-relax-60",
    ],
  },
  {
    method: "rescheduleBlock",
    code: "BLOCK_RESCHEDULED",
    command: {
      idempotencyKey,
      entryId: resourceId,
      expectedVersion: 5,
      date: "2035-02-05",
      startMinutes: 720,
      durationMinutes: 30,
    },
    parameters: [
      identity.userId,
      idempotencyKey,
      fingerprint,
      resourceId,
      5,
      "2035-02-05",
      720,
      30,
      0,
    ],
  },
  {
    method: "setAppointmentStatus",
    code: "APPOINTMENT_STATUS_UPDATED",
    command: {
      idempotencyKey,
      entryId: resourceId,
      expectedVersion: 6,
      status: "completed",
    },
    parameters: [
      identity.userId,
      idempotencyKey,
      fingerprint,
      resourceId,
      6,
      "completed",
    ],
  },
];

function commandFor(method: OwnerScheduleEditMethodName) {
  return editCases.find((candidate) => candidate.method === method)!.command;
}

describe("owner schedule edit repository", () => {
  it.each(editCases)(
    "binds exact $method query parameters and a copied fingerprint",
    async ({ method, code, command, parameters }) => {
      const expected = result(200, code) as OwnerScheduleCommandResult;
      const fixture = setup([expected]);

      await expect(
        fixture.repository[method](identity, command, fingerprint),
      ).resolves.toEqual(expected);

      expect(fixture.ownerTransaction).toHaveBeenCalledOnce();
      expect(fixture.unsafe).toHaveBeenCalledOnce();
      const [query, boundParameters] = fixture.unsafe.mock.calls[0]!;
      expect(query).toBe(OWNER_SCHEDULE_COMMAND_CONTRACTS[method].query);
      expect(boundParameters).toEqual(parameters);
      expect(boundParameters?.[2]).not.toBe(fingerprint);
    },
  );

  it.each(editCases)(
    "rejects $method versions above the PostgreSQL integer cap before DB work",
    async ({ method, command }) => {
      const fixture = setup([]);
      await expect(
        fixture.repository[method](
          identity,
          { ...command, expectedVersion: 2_147_483_648 },
          fingerprint,
        ),
      ).rejects.toThrow();
      expect(fixture.ownerTransaction).not.toHaveBeenCalled();
    },
  );

  it.each(editCases)(
    "requires the exact requested resource on $method success",
    async ({ method, code, command }) => {
      const fixture = setup([result(200, code, otherResourceId)]);
      await expect(
        fixture.repository[method](identity, command, fingerprint),
      ).rejects.toThrow("Unexpected owner schedule command result");
    },
  );

  it.each([
    ["no row", []],
    [
      "duplicate rows",
      [
        result(200, "BLOCK_DETAILS_UPDATED"),
        result(200, "BLOCK_DETAILS_UPDATED"),
      ],
    ],
    [
      "extra row field",
      [{ ...result(200, "BLOCK_DETAILS_UPDATED"), private_detail: "hidden" }],
    ],
    ["success without resource", [result(200, "BLOCK_DETAILS_UPDATED", "")]],
    ["failure with resource", [result(404, "BLOCK_NOT_FOUND")]],
  ] as const)("rejects %s", async (_label, rows) => {
    const fixture = setup([...rows]);
    await expect(
      fixture.repository.updateBlock(
        identity,
        commandFor("updateBlock"),
        fingerprint,
      ),
    ).rejects.toThrow("Unexpected owner schedule command result");
  });

  it.each([
    ["updateAppointment", 400, "APPOINTMENT_DETAILS_INVALID"],
    ["updateBlock", 404, "BLOCK_NOT_FOUND"],
    ["rescheduleAppointment", 409, "APPOINTMENT_NOT_RESCHEDULABLE"],
    ["rescheduleBlock", 400, "RESCHEDULE_NO_CHANGE"],
    ["setAppointmentStatus", 400, "STATUS_TRANSITION_INVALID"],
    ["setAppointmentStatus", 409, "STATUS_TRANSITION_INVALID"],
  ] as const)(
    "accepts exact $method failure pair $status/$code",
    async (method, status, code) => {
      const failure = result(status, code, "") as OwnerScheduleCommandResult;
      const fixture = setup([failure]);
      await expect(
        fixture.repository[method](identity, commandFor(method), fingerprint),
      ).resolves.toEqual(failure);
    },
  );

  it.each([
    [400, "VERSION_CONFLICT"],
    [409, "APPOINTMENT_NOT_FOUND"],
  ] as const)(
    "rejects cross-paired status failure %i/%s",
    async (status, code) => {
      const fixture = setup([result(status, code, "")]);
      await expect(
        fixture.repository.setAppointmentStatus(
          identity,
          commandFor("setAppointmentStatus"),
          fingerprint,
        ),
      ).rejects.toThrow("Unexpected owner schedule command result");
    },
  );
});

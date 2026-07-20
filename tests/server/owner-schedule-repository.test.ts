import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import {
  createOwnerScheduleRepository,
  type OwnerScheduleCommandResult,
  type OwnerScheduleRepository,
} from "@/lib/server/database/ownerScheduleRepository.ts";
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

function success(
  httpStatus: 200 | 201,
  code: string,
): OwnerScheduleCommandResult {
  return {
    http_status: httpStatus,
    result: { code, resource_id: resourceId },
    replayed: false,
  };
}

function setup(rows: Array<Record<string, unknown>>) {
  const unsafe = vi.fn<RuntimeTransaction["unsafe"]>(async (query) =>
    query.includes("authorize_cutover_write")
      ? [{ is_canary: false, canary_run_id: null, canary_grant_id: null }]
      : rows,
  );
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

interface CommandCase {
  method: keyof OwnerScheduleRepository;
  functionName: string;
  result: OwnerScheduleCommandResult;
  command: Record<string, unknown>;
  parameters: readonly unknown[];
}

const commandCases: readonly CommandCase[] = [
  {
    method: "createAppointment",
    functionName: "owner_create_appointment",
    result: success(201, "APPOINTMENT_CREATED"),
    command: {
      idempotencyKey,
      date: "2026-08-10",
      startMinutes: 600,
      serviceId: "massaggio-relax",
      variantId: "massaggio-relax-60",
      clientName: " Cliente Test ",
      clientEmail: " CLIENT@example.test ",
      clientPhone: "+39 333 123 4567",
    },
    parameters: [
      identity.userId,
      idempotencyKey,
      fingerprint,
      "2026-08-10",
      600,
      "massaggio-relax",
      "massaggio-relax-60",
      "Cliente Test",
      "client@example.test",
      "+393331234567",
      null,
    ],
  },
  {
    method: "createBlock",
    functionName: "owner_create_block",
    result: success(201, "BLOCK_CREATED"),
    command: {
      idempotencyKey,
      date: "2026-08-10",
      startMinutes: 720,
      durationMinutes: 30,
      internalNote: " Pausa ",
    },
    parameters: [
      identity.userId,
      idempotencyKey,
      fingerprint,
      "2026-08-10",
      720,
      30,
      0,
      "Pausa",
    ],
  },
  {
    method: "cancelScheduleEntry",
    functionName: "owner_cancel_schedule_entry",
    result: success(200, "SCHEDULE_ENTRY_CANCELLED"),
    command: {
      idempotencyKey,
      entryId: resourceId,
      expectedVersion: 2,
      reason: " Richiesta cliente ",
    },
    parameters: [
      identity.userId,
      idempotencyKey,
      fingerprint,
      resourceId,
      2,
      "Richiesta cliente",
    ],
  },
  {
    method: "createVacation",
    functionName: "owner_create_vacation",
    result: success(201, "VACATION_CREATED"),
    command: {
      idempotencyKey,
      startDate: "2026-08-17",
      endDate: "2026-08-21",
      reason: " Ferie ",
    },
    parameters: [
      identity.userId,
      idempotencyKey,
      fingerprint,
      "2026-08-17",
      "2026-08-21",
      "Ferie",
    ],
  },
  {
    method: "updateVacation",
    functionName: "owner_update_vacation",
    result: success(200, "VACATION_UPDATED"),
    command: {
      idempotencyKey,
      vacationId: resourceId,
      expectedVersion: 2,
      startDate: "2026-08-18",
      endDate: "2026-08-22",
      reason: " Ferie aggiornate ",
    },
    parameters: [
      identity.userId,
      idempotencyKey,
      fingerprint,
      resourceId,
      2,
      "2026-08-18",
      "2026-08-22",
      "Ferie aggiornate",
    ],
  },
  {
    method: "cancelVacation",
    functionName: "owner_cancel_vacation",
    result: success(200, "VACATION_CANCELLED"),
    command: {
      idempotencyKey,
      vacationId: resourceId,
      expectedVersion: 3,
    },
    parameters: [identity.userId, idempotencyKey, fingerprint, resourceId, 3],
  },
];

describe("owner schedule repository", () => {
  it.each(commandCases)(
    "executes one bounded $method function call",
    async ({ method, functionName, result, command, parameters }) => {
      const fixture = setup([result]);

      await expect(
        fixture.repository[method](identity, command, fingerprint),
      ).resolves.toEqual(result);

      expect(fixture.ownerTransaction).toHaveBeenCalledTimes(1);
      expect(fixture.unsafe).toHaveBeenCalledTimes(2);
      expect(fixture.unsafe.mock.calls[0]?.[0]).toContain(
        "authorize_cutover_write",
      );
      const [query, boundParameters] = fixture.unsafe.mock.calls[1]!;
      expect(query).toContain(`gioia_private.${functionName}`);
      expect(query.match(/\bselect\b/gi)).toHaveLength(1);
      expect(query).toMatch(/\)\s+as command\s+limit 2\s*$/i);
      expect(query).not.toMatch(/schedule_entries|vacations/i);
      expect(boundParameters).toEqual(parameters);
      expect(boundParameters?.[2]).not.toBe(fingerprint);
    },
  );

  it("accepts a strict resource-free failure row", async () => {
    const failure = {
      http_status: 409,
      result: { code: "SLOT_UNAVAILABLE" },
      replayed: false,
    };
    const fixture = setup([failure]);

    await expect(
      fixture.repository.createBlock(
        identity,
        commandCases[1]!.command,
        fingerprint,
      ),
    ).resolves.toEqual(failure);
  });

  it("rejects invalid input before opening a transaction", async () => {
    const cases: Array<{
      identity: Record<string, unknown>;
      command: Record<string, unknown>;
      fingerprint: Buffer;
    }> = [
      {
        identity: { ...identity, extra: true },
        command: commandCases[0]!.command,
        fingerprint,
      },
      {
        identity,
        command: { ...commandCases[0]!.command, status: "confirmed" },
        fingerprint,
      },
      {
        identity,
        command: commandCases[0]!.command,
        fingerprint: Buffer.alloc(31),
      },
    ];

    for (const invalid of cases) {
      const fixture = setup([]);
      await expect(
        fixture.repository.createAppointment(
          invalid.identity as typeof identity,
          invalid.command,
          invalid.fingerprint,
        ),
      ).rejects.toThrow();
      expect(fixture.ownerTransaction).not.toHaveBeenCalled();
    }
  });

  it("rejects versions outside the PostgreSQL integer range before binding", async () => {
    for (const method of ["cancelScheduleEntry", "cancelVacation"] as const) {
      const fixture = setup([]);
      const command = {
        ...commandCases.find((candidate) => candidate.method === method)!
          .command,
        expectedVersion: 2_147_483_648,
      };

      await expect(
        fixture.repository[method](identity, command, fingerprint),
      ).rejects.toThrow();
      expect(fixture.ownerTransaction).not.toHaveBeenCalled();
    }
  });
});

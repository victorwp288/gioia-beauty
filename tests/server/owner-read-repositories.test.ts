import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { createOwnerOperationsReadRepository } from "@/lib/server/database/ownerOperationsReadRepository.ts";
import { createOwnerOutboxListReadRequest } from "@/lib/server/database/ownerOutboxReadContract.ts";
import { OwnerReadRepositoryResultError } from "@/lib/server/database/ownerReadRepositorySupport.ts";
import { createOwnerScheduleCountReadRequest } from "@/lib/server/database/ownerScheduleCountReadContract.ts";
import { createOwnerScheduleExportReadRequest } from "@/lib/server/database/ownerScheduleExportReadContract.ts";
import { createOwnerScheduleListReadRequest } from "@/lib/server/database/ownerScheduleReadContract.ts";
import { createOwnerScheduleReadRepository } from "@/lib/server/database/ownerScheduleReadRepository.ts";
import { createOwnerSubscriberListReadRequest } from "@/lib/server/database/ownerSubscriberReadContract.ts";
import { createOwnerVacationListReadRequest } from "@/lib/server/database/ownerVacationReadContract.ts";
import type {
  DatabaseRow,
  OwnerTransactionIdentity,
  RuntimeDatabase,
  RuntimeTransaction,
} from "@/lib/server/database/runtime.ts";

import { cursorCodec, NOW } from "./pagination-cursor-fixture.ts";

const IDENTITY = Object.freeze({
  userId: "11111111-1111-4111-8111-111111111111",
  sessionId: "22222222-2222-4222-8222-222222222222",
});

function issued<T>(result: { ok: true; request: T } | { ok: false }): T {
  if (!result.ok) throw new Error("test fixture did not issue a request");
  return result.request;
}

function fakeDatabase(rows: DatabaseRow[]) {
  const unsafe = vi.fn(async () => rows);
  const ownerTransaction = vi.fn(
    async <T>(
      _identity: OwnerTransactionIdentity,
      work: (transaction: RuntimeTransaction) => Promise<T>,
    ) => work({ unsafe }),
  );
  return {
    database: { ownerTransaction } as Pick<RuntimeDatabase, "ownerTransaction">,
    ownerTransaction,
    unsafe,
  };
}

describe("owner bounded read repositories", () => {
  it("executes the schedule list function with the issued bound and exact arguments", async () => {
    const runtime = fakeDatabase([{ item: { id: "row-1" } }]);
    const repository = createOwnerScheduleReadRepository(runtime.database);
    const request = issued(
      createOwnerScheduleListReadRequest({
        query: {
          fromDate: "2026-07-01",
          toDate: "2026-07-31",
          kind: "appointment",
          statuses: ["confirmed"],
          pageSize: 25,
        },
        cursorCodec: cursorCodec(),
        now: NOW,
      }),
    );

    await expect(repository.listSchedule(IDENTITY, request)).resolves.toEqual([
      { id: "row-1" },
    ]);
    expect(runtime.ownerTransaction).toHaveBeenCalledWith(
      IDENTITY,
      expect.any(Function),
    );
    expect(runtime.unsafe).toHaveBeenCalledWith(
      expect.stringContaining("list_schedule_as_owner"),
      [
        IDENTITY.userId,
        "2026-07-01",
        "2026-07-31",
        "appointment",
        ["confirmed"],
        null,
        null,
        null,
        26,
      ],
    );
  });

  it("executes schedule count and export through their exact function signatures", async () => {
    const countRuntime = fakeDatabase([
      { kind: "appointment", status: "confirmed", count: 3 },
    ]);
    const countRepository = createOwnerScheduleReadRepository(
      countRuntime.database,
    );
    const countRequest = createOwnerScheduleCountReadRequest({
      fromDate: "2026-07-01",
      toDate: "2026-07-07",
    });
    await expect(
      countRepository.countSchedule(IDENTITY, countRequest),
    ).resolves.toEqual([
      { kind: "appointment", status: "confirmed", count: 3 },
    ]);
    expect(countRuntime.unsafe).toHaveBeenCalledWith(
      expect.stringContaining("count_schedule_as_owner"),
      [IDENTITY.userId, "2026-07-01", "2026-07-07", null, []],
    );

    const exportRuntime = fakeDatabase([{ item: { id: "export-1" } }]);
    const exportRepository = createOwnerScheduleReadRepository(
      exportRuntime.database,
    );
    const exportRequest = issued(
      createOwnerScheduleExportReadRequest({
        query: {
          fromDate: "2026-01-01",
          toDate: "2026-12-31",
          format: "csv",
          includeNotes: false,
          pageSize: 200,
        },
        cursorCodec: cursorCodec(),
        now: NOW,
      }),
    );
    await expect(
      exportRepository.exportSchedule(IDENTITY, exportRequest),
    ).resolves.toEqual([{ id: "export-1" }]);
    expect(exportRuntime.unsafe).toHaveBeenCalledWith(
      expect.stringContaining("export_schedule_as_owner"),
      [
        IDENTITY.userId,
        "2026-01-01",
        "2026-12-31",
        false,
        null,
        null,
        null,
        201,
      ],
    );
  });

  it("executes vacation, subscriber, and outbox list functions with keyset bounds", async () => {
    const vacationRuntime = fakeDatabase([{ item: { id: "vacation-1" } }]);
    const vacationRepository = createOwnerOperationsReadRepository(
      vacationRuntime.database,
    );
    const vacationRequest = issued(
      createOwnerVacationListReadRequest({
        query: {
          fromDate: "2026-01-01",
          toDate: "2026-12-31",
          pageSize: 40,
        },
        cursorCodec: cursorCodec(),
        now: NOW,
      }),
    );
    await expect(
      vacationRepository.listVacations(IDENTITY, vacationRequest),
    ).resolves.toEqual([{ id: "vacation-1" }]);
    expect(vacationRuntime.unsafe).toHaveBeenCalledWith(
      expect.stringContaining("list_vacations_as_owner"),
      [IDENTITY.userId, "2026-01-01", "2026-12-31", null, null, 41],
    );

    const subscriberRuntime = fakeDatabase([
      {
        cursor_created_at: "2026-07-10T11:59:59.123456Z",
        item: { id: "subscriber-1" },
      },
    ]);
    const subscriberRepository = createOwnerOperationsReadRepository(
      subscriberRuntime.database,
    );
    const subscriberRequest = issued(
      createOwnerSubscriberListReadRequest({
        query: { statuses: ["active"], pageSize: 10 },
        cursorCodec: cursorCodec(),
        now: NOW,
      }),
    );
    await expect(
      subscriberRepository.listSubscribers(IDENTITY, subscriberRequest),
    ).resolves.toEqual([
      {
        cursorCreatedAt: "2026-07-10T11:59:59.123456Z",
        item: { id: "subscriber-1" },
      },
    ]);
    expect(subscriberRuntime.unsafe).toHaveBeenCalledWith(
      expect.stringContaining("list_newsletter_subscribers_as_owner"),
      [IDENTITY.userId, ["active"], null, null, 11],
    );

    const outboxRuntime = fakeDatabase([]);
    const outboxRepository = createOwnerOperationsReadRepository(
      outboxRuntime.database,
    );
    const outboxRequest = issued(
      createOwnerOutboxListReadRequest({
        query: { statuses: ["pending"], pageSize: 12 },
        cursorCodec: cursorCodec(),
        now: NOW,
      }),
    );
    await expect(
      outboxRepository.listOutbox(IDENTITY, outboxRequest),
    ).resolves.toEqual([]);
    expect(outboxRuntime.unsafe).toHaveBeenCalledWith(
      expect.stringContaining("list_email_outbox_as_owner"),
      [IDENTITY.userId, ["pending"], null, null, 13],
    );
  });

  it("rejects unissued plans and non-exact database rows before returning data", async () => {
    const repository = createOwnerScheduleReadRepository(
      fakeDatabase([]).database,
    );
    await expect(
      repository.listSchedule(IDENTITY, {
        fromDate: "2026-07-01",
        toDate: "2026-07-01",
        kind: null,
        statuses: [],
        pageSize: 1,
        rowLimit: 2,
        after: null,
        order: ["date", "startMinutes", "id"] as const,
        filterFingerprint: "a".repeat(64),
      }),
    ).rejects.toThrow();

    const runtime = fakeDatabase([{ item: {}, extra: true }]);
    const exactRepository = createOwnerScheduleReadRepository(runtime.database);
    const request = issued(
      createOwnerScheduleListReadRequest({
        query: {
          fromDate: "2026-07-01",
          toDate: "2026-07-01",
          pageSize: 1,
        },
        cursorCodec: cursorCodec(),
        now: NOW,
      }),
    );
    await expect(
      exactRepository.listSchedule(IDENTITY, request),
    ).rejects.toThrow(OwnerReadRepositoryResultError);

    const overLimitRuntime = fakeDatabase([
      { item: {} },
      { item: {} },
      { item: {} },
    ]);
    const overLimitRepository = createOwnerScheduleReadRepository(
      overLimitRuntime.database,
    );
    await expect(
      overLimitRepository.listSchedule(IDENTITY, request),
    ).rejects.toThrow(OwnerReadRepositoryResultError);
  });
});

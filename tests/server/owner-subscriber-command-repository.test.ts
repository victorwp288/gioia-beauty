import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { OWNER_SUBSCRIBER_UNSUBSCRIBE_CONTRACT } from "@/lib/server/database/ownerScheduleCommandContracts.ts";
import { createOwnerSubscriberCommandRepository } from "@/lib/server/database/ownerSubscriberCommandRepository.ts";
import type {
  OwnerTransactionIdentity,
  RuntimeTransaction,
} from "@/lib/server/database/runtime.ts";

const USER_ID = "10000000-0000-4000-8000-000000000001";
const SESSION_ID = "20000000-0000-4000-8000-000000000001";
const SUBSCRIBER_ID = "30000000-0000-4000-8000-000000000001";
const IDEMPOTENCY_KEY = "40000000-0000-4000-8000-000000000001";
const FINGERPRINT = Buffer.alloc(32, 7);
const IDENTITY = { userId: USER_ID, sessionId: SESSION_ID };
const COMMAND = {
  idempotencyKey: IDEMPOTENCY_KEY,
  subscriberId: SUBSCRIBER_ID,
  expectedVersion: 2,
};

function row(
  status = 200,
  code = "SUBSCRIBER_UNSUBSCRIBED",
  replayed = false,
  resourceId: string | null = SUBSCRIBER_ID,
) {
  return {
    http_status: status,
    result: {
      code,
      ...(resourceId === null ? {} : { resource_id: resourceId }),
    },
    replayed,
  };
}

function setup(rows: Array<Record<string, unknown>>) {
  const unsafe = vi.fn(
    async (query: string, _parameters?: readonly unknown[]) =>
      query.includes("authorize_cutover_write")
        ? [{ is_canary: false, canary_run_id: null, canary_grant_id: null }]
        : rows,
  );
  const ownerTransaction = vi.fn();
  const database = {
    async ownerTransaction<T>(
      identity: OwnerTransactionIdentity,
      work: (transaction: RuntimeTransaction) => Promise<T>,
    ): Promise<T> {
      ownerTransaction(identity);
      return work({ unsafe });
    },
  };
  return {
    ownerTransaction,
    repository: createOwnerSubscriberCommandRepository(database),
    unsafe,
  };
}

describe("owner subscriber command repository", () => {
  it.each([false, true])(
    "binds the exact soft-unsubscribe command when replayed=%s",
    async (replayed) => {
      const fixture = setup([row(200, "SUBSCRIBER_UNSUBSCRIBED", replayed)]);

      await expect(
        fixture.repository.unsubscribeSubscriber(
          IDENTITY,
          COMMAND,
          FINGERPRINT,
          null,
        ),
      ).resolves.toEqual(row(200, "SUBSCRIBER_UNSUBSCRIBED", replayed));

      expect(fixture.ownerTransaction).toHaveBeenCalledWith(IDENTITY);
      expect(fixture.unsafe).toHaveBeenCalledTimes(2);
      expect(fixture.unsafe).toHaveBeenNthCalledWith(
        2,
        OWNER_SUBSCRIBER_UNSUBSCRIBE_CONTRACT.query,
        [USER_ID, IDEMPOTENCY_KEY, expect.any(Buffer), SUBSCRIBER_ID, 2],
      );
      const fingerprint = fixture.unsafe.mock.calls[1]![1]![2];
      expect(fingerprint).toEqual(FINGERPRINT);
      expect(fingerprint).not.toBe(FINGERPRINT);
    },
  );

  it.each([
    [404, "SUBSCRIBER_NOT_FOUND"],
    [409, "VERSION_CONFLICT"],
    [409, "SUBSCRIBER_NOT_UNSUBSCRIBABLE"],
  ])("accepts the handled %s %s result", async (status, code) => {
    const fixture = setup([row(status, code, false, null)]);
    await expect(
      fixture.repository.unsubscribeSubscriber(
        IDENTITY,
        COMMAND,
        FINGERPRINT,
        null,
      ),
    ).resolves.toEqual(row(status, code, false, null));
  });

  it.each([
    { rows: [] },
    { rows: [row(), row()] },
    { rows: [row(201)] },
    { rows: [row(200, "UNEXPECTED_CODE")] },
    { rows: [row(409, "SUBSCRIBER_NOT_FOUND", false, null)] },
    { rows: [row(404, "SUBSCRIBER_NOT_FOUND")] },
  ])("rejects malformed result %#", async ({ rows }) => {
    const fixture = setup(rows);
    await expect(
      fixture.repository.unsubscribeSubscriber(
        IDENTITY,
        COMMAND,
        FINGERPRINT,
        null,
      ),
    ).rejects.toThrow("Unexpected owner command result");
  });

  it.each([
    [{ ...IDENTITY, sessionId: "invalid" }, COMMAND, FINGERPRINT],
    [IDENTITY, { ...COMMAND, subscriberId: "invalid" }, FINGERPRINT],
    [IDENTITY, { ...COMMAND, expectedVersion: 0 }, FINGERPRINT],
    [IDENTITY, { ...COMMAND, expectedVersion: 2_147_483_648 }, FINGERPRINT],
    [IDENTITY, { ...COMMAND, status: "unsubscribed" }, FINGERPRINT],
    [IDENTITY, COMMAND, Buffer.alloc(31)],
  ])(
    "rejects invalid input %# before database work",
    async (identity, command, fingerprint) => {
      const fixture = setup([]);
      await expect(
        fixture.repository.unsubscribeSubscriber(
          identity,
          command,
          fingerprint,
          null,
        ),
      ).rejects.toThrow();
      expect(fixture.ownerTransaction).not.toHaveBeenCalled();
      expect(fixture.unsafe).not.toHaveBeenCalled();
    },
  );
});

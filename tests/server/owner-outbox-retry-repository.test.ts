import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import {
  OWNER_OUTBOX_RETRY_CONTRACT,
  createOwnerOutboxRetryRepository,
} from "@/lib/server/database/ownerOutboxRetryRepository.ts";
import type {
  OwnerTransactionIdentity,
  RuntimeTransaction,
} from "@/lib/server/database/runtime.ts";

const USER_ID = "10000000-0000-4000-8000-000000000001";
const SESSION_ID = "20000000-0000-4000-8000-000000000001";
const OUTBOX_ID = "30000000-0000-4000-8000-000000000001";
const IDEMPOTENCY_KEY = "40000000-0000-4000-8000-000000000001";
const FINGERPRINT = Buffer.alloc(32, 7);
const IDENTITY = { userId: USER_ID, sessionId: SESSION_ID };
const COMMAND = {
  idempotencyKey: IDEMPOTENCY_KEY,
  outboxId: OUTBOX_ID,
  expectedVersion: 2,
};

function row(
  status = 200,
  code = "OUTBOX_RETRY_SCHEDULED",
  replayed = false,
  resourceId: string | null = OUTBOX_ID,
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
      expect(identity).toEqual(IDENTITY);
      return work({ unsafe });
    },
  };
  return {
    ownerTransaction,
    repository: createOwnerOutboxRetryRepository(database),
    unsafe,
  };
}

describe("owner outbox retry repository", () => {
  it.each([false, true])(
    "binds the exact owner command when replayed=%s",
    async (replayed) => {
      const fixture = setup([row(200, "OUTBOX_RETRY_SCHEDULED", replayed)]);

      await expect(
        fixture.repository.retryOutbox(IDENTITY, COMMAND, FINGERPRINT),
      ).resolves.toEqual(row(200, "OUTBOX_RETRY_SCHEDULED", replayed));

      expect(fixture.ownerTransaction).toHaveBeenCalledOnce();
      expect(fixture.unsafe).toHaveBeenCalledTimes(2);
      expect(fixture.unsafe.mock.calls[0]?.[0]).toContain(
        "authorize_cutover_write",
      );
      const [query, parameters] = fixture.unsafe.mock.calls[1]!;
      expect(query).toBe(OWNER_OUTBOX_RETRY_CONTRACT.query);
      expect(query).toContain("gioia_private.retry_email_outbox_as_owner(");
      expect(query).toMatch(/\)\s+as command\s+limit 2\s*$/i);
      expect(parameters).toEqual([
        USER_ID,
        IDEMPOTENCY_KEY,
        FINGERPRINT,
        OUTBOX_ID,
        2,
      ]);
      expect(parameters?.[2]).not.toBe(FINGERPRINT);
    },
  );

  it("accepts only the exact handled conflict", async () => {
    const fixture = setup([row(409, "OUTBOX_RETRY_CONFLICT", false, null)]);
    await expect(
      fixture.repository.retryOutbox(IDENTITY, COMMAND, FINGERPRINT),
    ).resolves.toEqual(row(409, "OUTBOX_RETRY_CONFLICT", false, null));
  });

  it.each([
    { rows: [] },
    { rows: [row(), row()] },
    { rows: [row(201)] },
    { rows: [row(200, "UNEXPECTED_CODE")] },
    { rows: [row(200, "OUTBOX_RETRY_SCHEDULED", false, USER_ID)] },
    { rows: [row(409, "OUTBOX_RETRY_CONFLICT")] },
    { rows: [{ ...row(), extra: true }] },
  ])("rejects malformed result %#", async ({ rows }) => {
    const fixture = setup(rows);
    await expect(
      fixture.repository.retryOutbox(IDENTITY, COMMAND, FINGERPRINT),
    ).rejects.toThrow("Unexpected owner command result");
  });

  it.each([
    [{ ...IDENTITY, sessionId: "invalid" }, COMMAND, FINGERPRINT],
    [IDENTITY, { ...COMMAND, outboxId: "invalid" }, FINGERPRINT],
    [IDENTITY, { ...COMMAND, expectedVersion: 0 }, FINGERPRINT],
    [IDENTITY, { ...COMMAND, expectedVersion: 2_147_483_648 }, FINGERPRINT],
    [IDENTITY, { ...COMMAND, extra: true }, FINGERPRINT],
    [IDENTITY, COMMAND, Buffer.alloc(31)],
  ])(
    "rejects invalid input %# before database work",
    async (identity, command, fingerprint) => {
      const fixture = setup([]);
      await expect(
        fixture.repository.retryOutbox(identity, command, fingerprint),
      ).rejects.toThrow();
      expect(fixture.ownerTransaction).not.toHaveBeenCalled();
      expect(fixture.unsafe).not.toHaveBeenCalled();
    },
  );
});

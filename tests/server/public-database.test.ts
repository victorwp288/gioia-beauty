import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { createPublicBookingRepository } from "@/lib/server/database/publicBookingRepository.ts";
import {
  DatabaseConfigurationError,
  createRuntimeDatabase,
  type RuntimeDatabase,
  type RuntimeDatabaseOptions,
  type RuntimeSqlClient,
  type RuntimeTransaction,
} from "@/lib/server/database/runtime.ts";

describe("runtime Postgres adapter", () => {
  it("initializes lazily with bounded transaction-pooler settings", async () => {
    const unsafe = vi.fn<RuntimeTransaction["unsafe"]>(async () => []);
    const transaction = { unsafe } as RuntimeTransaction;
    const client: RuntimeSqlClient = {
      begin: vi.fn(async (work) => work(transaction)),
    };
    const clientFactory = vi.fn<
      NonNullable<RuntimeDatabaseOptions["clientFactory"]>
    >(() => client);
    const database = createRuntimeDatabase({
      env: {
        SUPABASE_DATABASE_URL:
          "postgresql://app_runtime:synthetic@127.0.0.1:54322/postgres",
      },
      clientFactory,
    });

    expect(clientFactory).not.toHaveBeenCalled();
    await database.transaction((tx) => tx.unsafe("select bounded_call()"));

    expect(clientFactory).toHaveBeenCalledTimes(1);
    expect(clientFactory.mock.calls[0]?.[1]).toMatchObject({
      prepare: false,
      max: 2,
      idle_timeout: 20,
      connect_timeout: 5,
      max_lifetime: 60,
      debug: false,
    });
    expect(unsafe.mock.calls.map(([query]) => query)).toEqual([
      "set local role app_runtime",
      expect.stringContaining("statement_timeout"),
      "select bounded_call()",
    ]);
  });

  it("fails without reflecting a missing or malformed database URL", async () => {
    const database = createRuntimeDatabase({
      env: { SUPABASE_DATABASE_URL: "secret-not-a-url" },
      clientFactory: vi.fn(),
    });

    const error = await database
      .transaction(async () => undefined)
      .catch((caught) => caught);
    expect(error).toEqual(new DatabaseConfigurationError());
    expect(String(error)).not.toContain("secret-not-a-url");
  });
});

describe("public booking repository", () => {
  function fakeDatabase(rows: Array<Record<string, unknown>>) {
    const unsafe = vi.fn<RuntimeTransaction["unsafe"]>(async () => rows);
    const transaction = vi.fn(
      async (work: (tx: RuntimeTransaction) => unknown) =>
        work({ unsafe } as RuntimeTransaction),
    );
    return {
      database: {
        transaction: transaction as RuntimeDatabase["transaction"],
      },
      transaction,
      unsafe,
    };
  }

  it("makes exactly one bounded availability function call", async () => {
    const fake = fakeDatabase([{ start_minutes: 600 }]);
    const repository = createPublicBookingRepository(fake.database);

    await expect(
      repository.getAvailability({
        date: "2026-08-10",
        serviceId: "manicure",
        variantId: "manicure-30-min",
      }),
    ).resolves.toEqual([{ start_minutes: 600 }]);

    expect(fake.transaction).toHaveBeenCalledTimes(1);
    expect(fake.unsafe).toHaveBeenCalledTimes(1);
    expect(fake.unsafe.mock.calls[0]?.[0]).toContain(
      "gioia_private.get_public_availability",
    );
    expect(fake.unsafe.mock.calls[0]?.[0]).toContain("limit 96");
    expect(fake.unsafe.mock.calls[0]?.[1]).toEqual([
      "2026-08-10",
      "manicure",
      "manicure-30-min",
    ]);
  });

  it("passes only hashes and normalized command fields to one booking call", async () => {
    const row = {
      http_status: 201,
      result: {
        code: "BOOKING_CREATED",
        resource_id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
      },
      replayed: false,
    };
    const fake = fakeDatabase([row]);
    const repository = createPublicBookingRepository(fake.database);
    const hash = Buffer.alloc(32, 1);

    await expect(
      repository.createBooking({
        principalScopeHash: hash,
        idempotencyKey: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
        requestFingerprint: hash,
        date: "2026-08-10",
        startMinutes: 600,
        serviceId: "manicure",
        variantId: "manicure-30-min",
        clientName: "Cliente Test",
        clientEmail: "client@example.test",
        clientPhone: "+39000000000",
        clientNote: null,
      }),
    ).resolves.toEqual(row);

    expect(fake.transaction).toHaveBeenCalledTimes(1);
    expect(fake.unsafe).toHaveBeenCalledTimes(1);
    expect(fake.unsafe.mock.calls[0]?.[0]).toContain(
      "gioia_private.create_public_booking",
    );
    expect(fake.unsafe.mock.calls[0]?.[0]).toContain("limit 1");
    expect(fake.unsafe.mock.calls[0]?.[1]?.[0]).toBe(hash);
  });

  it("rejects missing or multiple command rows", async () => {
    for (const rows of [[], [{}, {}]]) {
      const fake = fakeDatabase(rows);
      const repository = createPublicBookingRepository(fake.database);
      await expect(
        repository.createBooking({
          principalScopeHash: Buffer.alloc(32),
          idempotencyKey: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
          requestFingerprint: Buffer.alloc(32),
          date: "2026-08-10",
          startMinutes: 600,
          serviceId: "manicure",
          variantId: "manicure-30-min",
          clientName: "Test",
          clientEmail: "test@example.test",
          clientPhone: "+39000000000",
          clientNote: null,
        }),
      ).rejects.toThrow("Unexpected booking command result");
    }
  });
});

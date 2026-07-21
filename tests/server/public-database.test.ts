import { readFileSync } from "node:fs";

import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { createPublicBookingRepository } from "@/lib/server/database/publicBookingRepository.ts";
import {
  DatabaseAuthorizationContextError,
  DatabaseConfigurationError,
  createRuntimeDatabase,
  type RuntimeDatabase,
  type RuntimeDatabaseOptions,
  type RuntimeSqlClient,
  type RuntimeTransaction,
} from "@/lib/server/database/runtime.ts";

const SUPABASE_CA_CERTIFICATE = readFileSync(
  "config/certificates/supabase-prod-ca-2021.crt",
  "utf8",
);

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
      expect.stringContaining("request.jwt.claim.sub"),
      "select bounded_call()",
    ]);
    expect(unsafe.mock.calls[1]?.[1]).toEqual(["", ""]);
  });

  it("binds one validated owner UUID to the transaction-local Auth context", async () => {
    const unsafe = vi.fn<RuntimeTransaction["unsafe"]>(async () => []);
    const client: RuntimeSqlClient = {
      begin: vi.fn(async (work) => work({ unsafe } as RuntimeTransaction)),
    };
    const database = createRuntimeDatabase({ client });
    const identity = {
      userId: "10000000-0000-4000-8000-000000000001",
      sessionId: "20000000-0000-4000-8000-000000000001",
    };

    await database.ownerTransaction(identity, (transaction) =>
      transaction.unsafe("select owner_command()"),
    );

    expect(unsafe.mock.calls[1]?.[0]).toContain("request.jwt.claim.sub");
    expect(unsafe.mock.calls[1]?.[0]).toContain("request.jwt.claim.session_id");
    expect(unsafe.mock.calls[1]?.[1]).toEqual([
      identity.userId,
      identity.sessionId,
    ]);
    expect(unsafe.mock.calls[2]?.[0]).toBe("select owner_command()");
  });

  it("rejects malformed owner context before opening a transaction", async () => {
    const client: RuntimeSqlClient = { begin: vi.fn() };
    const database = createRuntimeDatabase({ client });

    await expect(
      database.ownerTransaction(
        {
          userId: "not-a-user-id",
          sessionId: "also-not-a-session-id",
        },
        async () => undefined,
      ),
    ).rejects.toEqual(new DatabaseAuthorizationContextError());
    expect(client.begin).not.toHaveBeenCalled();
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

  it("pins the Supabase CA for a remote verify-full database URL", async () => {
    const unsafe = vi.fn<RuntimeTransaction["unsafe"]>(async () => []);
    const client: RuntimeSqlClient = {
      begin: vi.fn(async (work) => work({ unsafe } as RuntimeTransaction)),
    };
    const clientFactory = vi.fn<
      NonNullable<RuntimeDatabaseOptions["clientFactory"]>
    >(() => client);
    const database = createRuntimeDatabase({
      env: {
        SUPABASE_DATABASE_CA_CERTIFICATE: SUPABASE_CA_CERTIFICATE,
        SUPABASE_PROJECT_REF: "lxvsspniipcotimbsfqm",
        SUPABASE_DATABASE_URL:
          "postgresql://app_runtime_login.lxvsspniipcotimbsfqm:synthetic@" +
          "aws-1-eu-central-2.pooler.supabase.com:6543/postgres?sslmode=verify-full",
      },
      clientFactory,
    });

    await database.transaction((tx) => tx.unsafe("select bounded_call()"));

    expect(clientFactory).toHaveBeenCalledTimes(1);
    expect(clientFactory.mock.calls[0]?.[1].ssl).toEqual({
      ca: SUPABASE_CA_CERTIFICATE,
      rejectUnauthorized: true,
    });
  });

  it("keeps IPv6 loopback local without requiring a remote CA", async () => {
    const unsafe = vi.fn<RuntimeTransaction["unsafe"]>(async () => []);
    const client: RuntimeSqlClient = {
      begin: vi.fn(async (work) => work({ unsafe } as RuntimeTransaction)),
    };
    const clientFactory = vi.fn<
      NonNullable<RuntimeDatabaseOptions["clientFactory"]>
    >(() => client);
    const database = createRuntimeDatabase({
      env: {
        SUPABASE_DATABASE_URL:
          "postgresql://app_runtime:synthetic@[::1]:54322/postgres",
      },
      clientFactory,
    });

    await database.transaction((tx) => tx.unsafe("select bounded_call()"));

    expect(clientFactory.mock.calls[0]?.[1]).not.toHaveProperty("ssl");
  });

  it.each([
    ["missing CA", undefined],
    ["changed CA", "not the pinned Supabase CA"],
    ["chained CA", `${SUPABASE_CA_CERTIFICATE}${SUPABASE_CA_CERTIFICATE}`],
  ])(
    "rejects a remote database with %s before client creation",
    async (_, ca) => {
      const clientFactory =
        vi.fn<NonNullable<RuntimeDatabaseOptions["clientFactory"]>>();
      const database = createRuntimeDatabase({
        env: {
          ...(ca ? { SUPABASE_DATABASE_CA_CERTIFICATE: ca } : {}),
          SUPABASE_PROJECT_REF: "lxvsspniipcotimbsfqm",
          SUPABASE_DATABASE_URL:
            "postgresql://app_runtime_login.lxvsspniipcotimbsfqm:synthetic@" +
            "aws-1-eu-central-2.pooler.supabase.com:6543/postgres?sslmode=verify-full",
        },
        clientFactory,
      });

      const error = await database
        .transaction(async () => undefined)
        .catch((caught) => caught);

      expect(error).toEqual(new DatabaseConfigurationError());
      expect(String(error)).not.toContain(String(ca));
      expect(clientFactory).not.toHaveBeenCalled();
    },
  );

  it("rejects a remote database without verify-full before client creation", async () => {
    const clientFactory =
      vi.fn<NonNullable<RuntimeDatabaseOptions["clientFactory"]>>();
    const database = createRuntimeDatabase({
      env: {
        SUPABASE_DATABASE_CA_CERTIFICATE: SUPABASE_CA_CERTIFICATE,
        SUPABASE_PROJECT_REF: "lxvsspniipcotimbsfqm",
        SUPABASE_DATABASE_URL:
          "postgresql://app_runtime_login.lxvsspniipcotimbsfqm:synthetic@" +
          "aws-1-eu-central-2.pooler.supabase.com:6543/postgres?sslmode=require",
      },
      clientFactory,
    });

    await expect(database.transaction(async () => undefined)).rejects.toEqual(
      new DatabaseConfigurationError(),
    );
    expect(clientFactory).not.toHaveBeenCalled();
  });

  it.each([
    [
      "app_runtime authorization role",
      "postgresql://app_runtime.lxvsspniipcotimbsfqm:synthetic@aws-1-eu-central-2.pooler.supabase.com:6543/postgres?sslmode=verify-full",
    ],
    [
      "postgres role",
      "postgresql://postgres.lxvsspniipcotimbsfqm:synthetic@aws-1-eu-central-2.pooler.supabase.com:6543/postgres?sslmode=verify-full",
    ],
    [
      "other role",
      "postgresql://other.lxvsspniipcotimbsfqm:synthetic@aws-1-eu-central-2.pooler.supabase.com:6543/postgres?sslmode=verify-full",
    ],
    [
      "direct connection",
      "postgresql://app_runtime_login:synthetic@db.lxvsspniipcotimbsfqm.supabase.co:5432/postgres?sslmode=verify-full",
    ],
  ])("rejects a remote %s before client creation", async (_, databaseUrl) => {
    const clientFactory =
      vi.fn<NonNullable<RuntimeDatabaseOptions["clientFactory"]>>();
    const database = createRuntimeDatabase({
      env: {
        SUPABASE_DATABASE_CA_CERTIFICATE: SUPABASE_CA_CERTIFICATE,
        SUPABASE_PROJECT_REF: "lxvsspniipcotimbsfqm",
        SUPABASE_DATABASE_URL: databaseUrl,
      },
      clientFactory,
    });

    await expect(database.transaction(async () => undefined)).rejects.toEqual(
      new DatabaseConfigurationError(),
    );
    expect(clientFactory).not.toHaveBeenCalled();
  });
});

describe("public booking repository", () => {
  function fakeDatabase(rows: Array<Record<string, unknown>>) {
    const unsafe = vi.fn<RuntimeTransaction["unsafe"]>(async (query) =>
      query.includes("authorize_cutover_write")
        ? [{ is_canary: false, canary_run_id: null, canary_grant_id: null }]
        : rows,
    );
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
    expect(fake.unsafe).toHaveBeenCalledTimes(2);
    expect(fake.unsafe.mock.calls[0]?.[0]).toContain(
      "gioia_private.authorize_cutover_write",
    );
    expect(fake.unsafe.mock.calls[1]?.[0]).toContain(
      "gioia_private.create_public_booking",
    );
    expect(fake.unsafe.mock.calls[1]?.[0]).toContain("limit 1");
    expect(fake.unsafe.mock.calls[1]?.[1]?.[0]).toBe(hash);
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

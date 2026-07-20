import { accessSync, constants, statSync } from "node:fs";
import { mkdir, rmdir } from "node:fs/promises";
import path from "node:path";

import { describe, expect, it, vi } from "vitest";

import {
  LOCAL_POSTGRES_CLONE_DATABASE,
  LOCAL_POSTGRES_MINIMUM_FREE_BYTES,
} from "../../scripts/local-postgres-clone-contract.mjs";
import {
  LOCAL_POSTGRES_CLONE_LOCK_PATH,
  withLocalPostgresLogicalClone,
} from "../../scripts/local-postgres-clone.mjs";
import {
  LOCAL_CLONE_ENVIRONMENT,
  LOCAL_CLONE_PASSWORD,
  localCloneStatus,
  localCloneStorage,
  successfulLocalCloneExecutor,
} from "./fixtures/localPostgresCloneFixture.js";

describe("Local Postgres logical clone orchestration", () => {
  it("dumps, fingerprints, restores, recreates, and cleans up", async () => {
    const calls = [];
    const execFileImpl = successfulLocalCloneExecutor(calls);
    let expiredRecreate;
    const result = await withLocalPostgresLogicalClone(
      async ({ connection, dump, identity, query, recreate }) => {
        expect(connection).toEqual({
          database: LOCAL_POSTGRES_CLONE_DATABASE,
          host: "127.0.0.1",
          port: "56322",
          user: "postgres",
        });
        expect(dump).toMatchObject({ bytes: 21, tocEntries: 1 });
        expect(dump.sha256).toMatch(/^[a-f0-9]{64}$/u);
        expect(dump.tocSha256).toMatch(/^[a-f0-9]{64}$/u);
        expect(identity.source).toMatchObject({
          collation: "C.UTF-8",
          ctype: "C.UTF-8",
          database: "postgres",
          encoding: "UTF8",
          serverMajor: 17,
          user: "postgres",
        });
        const activeDumpPath = calls
          .find(
            ({ args, file }) => file === "pg_dump" && args[0] !== "--version",
          )
          .args.find((arg) => arg.startsWith("--file="))
          .slice(7);
        expect(statSync(path.dirname(activeDumpPath)).mode & 0o777).toBe(0o700);
        expect(statSync(activeDumpPath).mode & 0o777).toBe(0o600);
        expect(
          statSync(path.join(path.dirname(activeDumpPath), "source.toc")).mode &
            0o777,
        ).toBe(0o600);
        expect(await query("select 1")).toBe("inspection-ok\n");
        await expect(recreate()).resolves.toMatchObject({
          database: LOCAL_POSTGRES_CLONE_DATABASE,
          serverMajor: 17,
        });
        expiredRecreate = recreate;
        return "verified";
      },
      {
        environment: LOCAL_CLONE_ENVIRONMENT,
        execFileImpl,
        status: localCloneStatus(),
        storage: localCloneStorage(),
      },
    );

    expect(result.value).toBe("verified");
    await expect(expiredRecreate()).rejects.toThrow("clone inspection scope");
    expect(JSON.stringify(result)).not.toContain(LOCAL_CLONE_PASSWORD);
    const dumps = calls.filter(
      ({ args, file }) => file === "pg_dump" && args[0] !== "--version",
    );
    expect(dumps).toHaveLength(1);
    expect(dumps[0].args).toEqual(
      expect.arrayContaining([
        "--format=custom",
        "--compress=zstd:9",
        "--serializable-deferrable",
        "--lock-wait-timeout=10s",
        "--no-publications",
        "--no-subscriptions",
      ]),
    );
    const dumpPath = dumps[0].args
      .find((arg) => arg.startsWith("--file="))
      .slice(7);
    expect(() => accessSync(dumpPath, constants.F_OK)).toThrow();

    const creates = calls.filter(
      ({ args, file }) => file === "createdb" && args[0] !== "--version",
    );
    expect(creates).toHaveLength(2);
    expect(creates[0].args).toEqual([
      "--template=template0",
      "--encoding=UTF8",
      "--owner=postgres",
      LOCAL_POSTGRES_CLONE_DATABASE,
    ]);
    const restores = calls.filter(
      ({ args, file }) =>
        file === "pg_restore" && args[0] === "--single-transaction",
    );
    expect(restores).toHaveLength(2);
    expect(restores[0].args.slice(0, 2)).toEqual([
      "--single-transaction",
      "--exit-on-error",
    ]);
    expect(restores[0].args).not.toContain("--no-owner");
    expect(restores[0].args).not.toContain("--no-acl");

    const drops = calls.filter(
      ({ args, file }) => file === "dropdb" && args[0] === "--force",
    );
    expect(drops).toHaveLength(2);
    for (const drop of drops) {
      expect(drop.args).toEqual([
        "--force",
        "--if-exists",
        LOCAL_POSTGRES_CLONE_DATABASE,
      ]);
    }
    for (const entry of calls.filter(({ args }) => args[0] !== "--version")) {
      const restore =
        entry.file === "pg_restore" && entry.args[0] === "--single-transaction";
      expect(entry.options).toMatchObject({
        maxBuffer: expect.any(Number),
        timeout: expect.any(Number),
      });
      expect(entry.options.env).toMatchObject({
        PGDATABASE: expect.any(String),
        PGHOST: "127.0.0.1",
        PGPASSWORD: LOCAL_CLONE_PASSWORD,
        PGPORT: "56322",
        PGUSER: restore ? "supabase_admin" : "postgres",
      });
      expect(entry.args.join(" ")).not.toMatch(/postgresql?:\/\//u);
      expect(entry.args.join(" ")).not.toContain(LOCAL_CLONE_PASSWORD);
    }
  });
});

function destructiveCalls(calls, file) {
  return calls.filter(
    ({ args, file: executable }) =>
      executable === file && args[0] !== "--version",
  );
}

describe("Local Postgres clone guardrails", () => {
  it("rejects non-Postgres-17 tools and redacts their output", async () => {
    const calls = [];
    const secret = "do-not-disclose";
    const execFileImpl = vi.fn(async (file, args, options) => {
      calls.push({ args, file, options });
      if (file === "pg_dump" && args[0] === "--version") {
        return { stdout: `pg_dump (PostgreSQL) 16.9 ${secret}`, stderr: "" };
      }
      if (file === "dropdb") return { stdout: "", stderr: "" };
      return { stdout: `${file} (PostgreSQL) 17.5`, stderr: "" };
    });
    const error = await withLocalPostgresLogicalClone(vi.fn(), {
      environment: LOCAL_CLONE_ENVIRONMENT,
      execFileImpl,
      status: localCloneStatus(),
      storage: localCloneStorage(),
    }).catch((caught) => caught);
    expect(error.message).toBe(
      "Local Postgres clone failed during pg_dump version preflight",
    );
    expect(error.message).not.toContain(secret);
    expect(destructiveCalls(calls, "dropdb")).toHaveLength(0);
  });

  it.each([
    { dumpContents: "", label: "zero-byte archive" },
    { label: "empty TOC", toc: "; comments only\n" },
  ])(
    "rejects a $label and still cleans the scratch target",
    async (fixture) => {
      const calls = [];
      const error = await withLocalPostgresLogicalClone(vi.fn(), {
        environment: LOCAL_CLONE_ENVIRONMENT,
        execFileImpl: successfulLocalCloneExecutor(calls, fixture),
        status: localCloneStatus(),
        storage: localCloneStorage(),
      }).catch((caught) => caught);
      expect(error.message).toBe(
        "Local Postgres clone failed during logical dump validation",
      );
      expect(destructiveCalls(calls, "dropdb")).toHaveLength(0);
    },
  );

  it("rejects source and clone identity drift", async () => {
    const calls = [];
    const error = await withLocalPostgresLogicalClone(vi.fn(), {
      environment: LOCAL_CLONE_ENVIRONMENT,
      execFileImpl: successfulLocalCloneExecutor(calls, {
        cloneIdentity: { collation: "unexpected-collation" },
      }),
      status: localCloneStatus(),
      storage: localCloneStorage(),
    }).catch((caught) => caught);
    expect(error.message).toBe(
      "Local Postgres clone failed during source and clone identity comparison",
    );
    expect(destructiveCalls(calls, "dropdb")).toHaveLength(1);
  });

  it("refuses a concurrent fixed-name rehearsal without touching Postgres", async () => {
    await mkdir(LOCAL_POSTGRES_CLONE_LOCK_PATH, { mode: 0o700 });
    const execFileImpl = vi.fn();
    try {
      const error = await withLocalPostgresLogicalClone(vi.fn(), {
        environment: LOCAL_CLONE_ENVIRONMENT,
        execFileImpl,
        status: localCloneStatus(),
        storage: localCloneStorage(),
      }).catch((caught) => caught);
      expect(error.message).toBe(
        "Local Postgres clone failed during orchestration",
      );
      expect(execFileImpl).not.toHaveBeenCalled();
      expect(() =>
        accessSync(LOCAL_POSTGRES_CLONE_LOCK_PATH, constants.F_OK),
      ).not.toThrow();
    } finally {
      await rmdir(LOCAL_POSTGRES_CLONE_LOCK_PATH);
    }
  });

  it("refuses a pre-existing scratch database without deleting it", async () => {
    const calls = [];
    const error = await withLocalPostgresLogicalClone(vi.fn(), {
      environment: LOCAL_CLONE_ENVIRONMENT,
      execFileImpl: successfulLocalCloneExecutor(calls, {
        scratchDatabaseCount: 1,
      }),
      status: localCloneStatus(),
      storage: localCloneStorage(),
    }).catch((caught) => caught);
    expect(error.message).toBe(
      "Local Postgres clone failed during scratch database preflight",
    );
    expect(destructiveCalls(calls, "dropdb")).toHaveLength(0);
    expect(destructiveCalls(calls, "createdb")).toHaveLength(0);
  });

  it("redacts callback errors and will not weaken the disk floor", async () => {
    const calls = [];
    const error = await withLocalPostgresLogicalClone(
      async () => {
        throw new Error(`sensitive ${LOCAL_CLONE_PASSWORD}`);
      },
      {
        environment: LOCAL_CLONE_ENVIRONMENT,
        execFileImpl: successfulLocalCloneExecutor(calls),
        status: localCloneStatus(),
        storage: localCloneStorage(),
      },
    ).catch((caught) => caught);
    expect(error.message).toBe(
      "Local Postgres clone failed during orchestration",
    );
    expect(error.message).not.toContain(LOCAL_CLONE_PASSWORD);
    expect(destructiveCalls(calls, "dropdb")).toHaveLength(1);

    await expect(
      withLocalPostgresLogicalClone(vi.fn(), {
        minimumFreeBytes: LOCAL_POSTGRES_MINIMUM_FREE_BYTES - 1,
        status: localCloneStatus(),
      }),
    ).rejects.toThrow("disk floor cannot be weakened");
  });

  it("refuses the rehearsal when temporary storage is below the floor", async () => {
    const execFileImpl = vi.fn();
    const storage = localCloneStorage();
    storage.statfs = vi.fn(async () => ({
      bavail: LOCAL_POSTGRES_MINIMUM_FREE_BYTES - 1,
      bsize: 1,
    }));
    const error = await withLocalPostgresLogicalClone(vi.fn(), {
      environment: LOCAL_CLONE_ENVIRONMENT,
      execFileImpl,
      status: localCloneStatus(),
      storage,
    }).catch((caught) => caught);
    expect(error.message).toBe(
      "Local Postgres clone failed during scratch disk preflight",
    );
    expect(execFileImpl).not.toHaveBeenCalled();
  });
});

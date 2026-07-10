import { EventEmitter } from "node:events";

import { describe, expect, it, vi } from "vitest";

import {
  GREENFIELD_RUNTIME_ROLE_SQL,
  GREENFIELD_TEST_LOCK_SQL,
  GREENFIELD_TEST_UNLOCK_SQL,
  withGreenfieldTestLock,
  withTemporaryRuntimeRole,
} from "../../scripts/test-target-harness.mjs";
import {
  greenfieldChildEnvironment,
  stopGreenfieldOwnerAuthServer,
} from "../../scripts/test-target-auth-server.mjs";

const operatorSessionUrl =
  "postgresql://postgres.ref:operator@pooler.test:5432/postgres?sslmode=verify-full";
const operatorWorkerUrl =
  "postgresql://postgres.ref:operator@pooler.test:6543/postgres?sslmode=verify-full";
const runtimeUrl =
  "postgresql://app_runtime.ref:runtime@pooler.test:6543/postgres?sslmode=verify-full";

function config() {
  return {
    apiUrl: "https://lxvsspniipcotimbsfqm.supabase.co/",
    projectRef: "lxvsspniipcotimbsfqm",
    deriveAppRuntimeDatabaseUrl: vi.fn(() => runtimeUrl),
    getOperatorSessionDatabaseUrl: () => operatorSessionUrl,
    getOperatorWorkerDatabaseUrl: () => operatorWorkerUrl,
    getPublishableKey: () => `sb_publishable_${"p".repeat(32)}`,
  };
}

function safeRoleState() {
  return [
    {
      rolcanlogin: false,
      has_unsafe_membership: false,
    },
  ];
}

function safeWorkerResult(query) {
  if (query === GREENFIELD_RUNTIME_ROLE_SQL.state) return safeRoleState();
  if (query === GREENFIELD_RUNTIME_ROLE_SQL.sessions[1]) {
    return [{ active: 0 }];
  }
  return [];
}

describe("greenfield TEST advisory lock", () => {
  it("uses separate clients, commits cleanup, and closes on callback failure", async () => {
    const callbackFailure = new Error("synthetic callback failure");
    const lockQueries = [];
    const lockClient = {
      unsafe: vi.fn(async (query) => {
        lockQueries.push(query);
        if (query === GREENFIELD_TEST_LOCK_SQL) return [{ acquired: true }];
        if (query === GREENFIELD_TEST_UNLOCK_SQL) return [{ released: true }];
        return safeWorkerResult(query);
      }),
      release: vi.fn(async () => {}),
    };
    const lockPool = {
      reserve: vi.fn(async () => lockClient),
      end: vi.fn(async () => {}),
    };
    const worker = { end: vi.fn(async () => {}) };
    const clientFactory = vi
      .fn()
      .mockReturnValueOnce(lockPool)
      .mockReturnValueOnce(worker);

    await expect(
      withGreenfieldTestLock(
        config(),
        async ({ worker: receivedWorker, recoverRuntimeRole }) => {
          expect(receivedWorker).toBe(worker);
          expect(recoverRuntimeRole).toBeTypeOf("function");
          throw callbackFailure;
        },
        { clientFactory },
      ),
    ).rejects.toBe(callbackFailure);

    expect(lockQueries).toEqual([
      GREENFIELD_TEST_LOCK_SQL,
      GREENFIELD_TEST_UNLOCK_SQL,
    ]);
    expect(clientFactory.mock.calls.map(([url]) => url)).toEqual([
      operatorSessionUrl,
      operatorWorkerUrl,
    ]);
    expect(lockPool.reserve).toHaveBeenCalledOnce();
    expect(lockClient.release).toHaveBeenCalledOnce();
    expect(lockPool.end).toHaveBeenCalledOnce();
    expect(worker.end).toHaveBeenCalledOnce();
    expect(clientFactory.mock.calls[0][1]).toMatchObject({
      idle_timeout: null,
      max_lifetime: null,
      max: 1,
      ssl: "verify-full",
    });
    expect(clientFactory.mock.calls[1][1]).toMatchObject({
      ssl: "verify-full",
    });
  });

  it("fails immediately when another TEST runner holds the lock", async () => {
    const callback = vi.fn();
    const clientFactory = vi
      .fn()
      .mockReturnValueOnce({
        reserve: async () => ({
          unsafe: async () => [{ acquired: false }],
          release: vi.fn(async () => {}),
        }),
        end: vi.fn(async () => {}),
      })
      .mockReturnValueOnce({ end: vi.fn(async () => {}) });

    await expect(
      withGreenfieldTestLock(config(), callback, { clientFactory }),
    ).rejects.toThrow("already locked");
    expect(callback).not.toHaveBeenCalled();
  });
});

describe("greenfield TEST temporary runtime role", () => {
  it("binds an in-memory password and always restores the role", async () => {
    const calls = [];
    const worker = {
      begin: async (callback) =>
        callback({
          unsafe: async (query, parameters) => {
            calls.push({ query, parameters });
            return [];
          },
        }),
      unsafe: async (query) => {
        calls.push({ query });
        return safeWorkerResult(query);
      },
    };
    const recoverRuntimeRole = vi.fn(async () => {});
    const password = `Aa9!${"x".repeat(40)}`;
    const callbackFailure = new Error("synthetic route failure");

    await expect(
      withTemporaryRuntimeRole({
        config: config(),
        worker,
        recoverRuntimeRole,
        callback: async ({ runtimeDatabaseUrl }) => {
          expect(runtimeDatabaseUrl).toBe(runtimeUrl);
          throw callbackFailure;
        },
        passwordFactory: () => password,
      }),
    ).rejects.toBe(callbackFailure);

    const passwordCall = calls.find(
      ({ query }) => query === GREENFIELD_RUNTIME_ROLE_SQL.setup[0],
    );
    expect(passwordCall.query).not.toContain(password);
    expect(passwordCall.parameters).toEqual([password]);
    expect(calls[0].query).toBe(GREENFIELD_RUNTIME_ROLE_SQL.sessions[0]);
    expect(
      calls.filter(
        ({ query }) => query === GREENFIELD_RUNTIME_ROLE_SQL.cleanup[0],
      ),
    ).toHaveLength(2);
    expect(recoverRuntimeRole).not.toHaveBeenCalled();
  });

  it("recovers an interrupted role before setup and after callback", async () => {
    const worker = {
      begin: async (callback) => callback({ unsafe: async () => [] }),
      unsafe: vi.fn(async () => {
        throw new Error("primary cleanup unavailable");
      }),
    };
    const recoverRuntimeRole = vi.fn(async () => {});

    await withTemporaryRuntimeRole({
      config: config(),
      worker,
      recoverRuntimeRole,
      callback: async () => {},
      passwordFactory: () => `Aa9!${"y".repeat(40)}`,
    });

    expect(recoverRuntimeRole).toHaveBeenCalledTimes(2);
    expect(worker.unsafe).toHaveBeenCalledTimes(2);
  });
});

describe("greenfield TEST process cleanup", () => {
  it("awaits forced process-tree termination", async () => {
    const child = Object.assign(new EventEmitter(), {
      exitCode: null,
      signalCode: null,
      pid: 4242,
      kill: vi.fn(),
    });
    const signals = [];
    const signalImpl = vi.fn((target, signal) => {
      signals.push(signal);
      if (signal === "SIGKILL") {
        target.signalCode = "SIGKILL";
        target.emit("exit");
      }
    });

    await stopGreenfieldOwnerAuthServer(child, {
      signalImpl,
      graceTimeout: 0,
    });

    expect(signals).toEqual(["SIGTERM", "SIGKILL"]);
    expect(child.kill).not.toHaveBeenCalled();
  });
});

describe("greenfield TEST child environment", () => {
  it("passes only the Preview runtime credential and required safe settings", () => {
    const env = greenfieldChildEnvironment(config(), runtimeUrl);
    expect(env).toMatchObject({
      APP_ENV: "preview",
      EMAIL_TRANSPORT: "fake",
      NEXT_PUBLIC_APP_ENV: "preview",
      SUPABASE_DATABASE_URL: runtimeUrl,
      SUPABASE_PROJECT_REF: "lxvsspniipcotimbsfqm",
      VERCEL_ENV: "preview",
    });
    expect(Object.keys(env).sort()).toEqual(
      [
        "APP_ENV",
        "BOOKING_HMAC_SECRET",
        "CI",
        "EMAIL_TRANSPORT",
        "HOME",
        "NEXT_PUBLIC_APP_ENV",
        "NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY",
        "NEXT_PUBLIC_SUPABASE_URL",
        "NEXT_TELEMETRY_DISABLED",
        "OWNER_SESSION_HMAC_SECRET",
        "PATH",
        "SUPABASE_DATABASE_URL",
        "SUPABASE_PROJECT_REF",
        "TMPDIR",
        "VERCEL_ENV",
      ].sort(),
    );
    expect(JSON.stringify(env)).not.toContain("postgres.ref:operator");
  });
});

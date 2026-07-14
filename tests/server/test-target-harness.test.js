import { EventEmitter } from "node:events";

import { describe, expect, it, vi } from "vitest";

import {
  GREENFIELD_RUNTIME_ROLE_SQL,
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
const CA_CERTIFICATE = "synthetic-ca-certificate";

function config() {
  return {
    apiUrl: "https://lxvsspniipcotimbsfqm.supabase.co/",
    projectRef: "lxvsspniipcotimbsfqm",
    getDatabaseCaCertificate: () => CA_CERTIFICATE,
    deriveAppRuntimeDatabaseUrl: vi.fn(() => runtimeUrl),
    getOperatorSessionDatabaseUrl: () => operatorSessionUrl,
    getOperatorWorkerDatabaseUrl: () => operatorWorkerUrl,
    getPreviewRuntimeDatabaseUrl: () => runtimeUrl,
    getPublishableKey: () => `sb_publishable_${"p".repeat(32)}`,
  };
}

function safeRoleState(rolcanlogin = false) {
  return [
    {
      attributes_are_safe: true,
      has_unsafe_membership: false,
      rolcanlogin,
    },
  ];
}

function safeWorkerResult(query, rolcanlogin = false) {
  if (query === GREENFIELD_RUNTIME_ROLE_SQL.state) {
    return safeRoleState(rolcanlogin);
  }
  if (query === GREENFIELD_RUNTIME_ROLE_SQL.sessions[1]) {
    return [{ active: 0 }];
  }
  return [];
}

describe("greenfield TEST advisory lock", () => {
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
    expect(recoverRuntimeRole).toHaveBeenCalledTimes(2);
  });

  it("uses the held-lock recovery before setup and after callback", async () => {
    const worker = {
      begin: async (callback) => callback({ unsafe: async () => [] }),
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
  });

  it("preserves callback and final temporary-role recovery failures", async () => {
    const callbackFailure = new Error("synthetic callback failure");
    const recoveryFailure = new Error("synthetic recovery failure");
    const recoverRuntimeRole = vi
      .fn()
      .mockResolvedValueOnce(undefined)
      .mockRejectedValueOnce(recoveryFailure);

    const error = await withTemporaryRuntimeRole({
      config: config(),
      worker: {
        begin: async (callback) => callback({ unsafe: async () => [] }),
      },
      recoverRuntimeRole,
      callback: async () => {
        throw callbackFailure;
      },
      passwordFactory: () => `Aa9!${"z".repeat(40)}`,
    }).catch((caught) => caught);

    expect(error).toBeInstanceOf(AggregateError);
    expect(error.errors).toEqual([callbackFailure, recoveryFailure]);
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
      SUPABASE_DATABASE_CA_CERTIFICATE: CA_CERTIFICATE,
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
        "SUPABASE_DATABASE_CA_CERTIFICATE",
        "SUPABASE_PROJECT_REF",
        "TMPDIR",
        "VERCEL_ENV",
      ].sort(),
    );
    expect(JSON.stringify(env)).not.toContain("postgres.ref:operator");
  });
});

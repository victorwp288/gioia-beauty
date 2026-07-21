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
  "postgresql://app_runtime_login.ref:runtime@pooler.test:6543/postgres?sslmode=verify-full";
const CA_CERTIFICATE = "synthetic-ca-certificate";

function runtimeCredentialVerifier(failure = null) {
  const credentialVerifier = vi.fn(async () => {
    if (failure) throw failure;
  });
  return {
    credentialVerifier,
  };
}

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
      credential_is_safe: true,
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
  it("closes the lock pool when worker initialization fails", async () => {
    const lockPool = {
      reserve: vi.fn(),
      end: vi.fn(async () => {}),
    };
    const initializationFailure = new Error("synthetic worker init failure");
    const clientFactory = vi
      .fn()
      .mockReturnValueOnce(lockPool)
      .mockImplementationOnce(() => {
        throw initializationFailure;
      });

    await expect(
      withGreenfieldTestLock(config(), vi.fn(), { clientFactory }),
    ).rejects.toBe(initializationFailure);

    expect(lockPool.reserve).not.toHaveBeenCalled();
    expect(lockPool.end).toHaveBeenCalledWith({ timeout: 5 });
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
  it("defaults to one 125-second quiet period before authentication", async () => {
    vi.useFakeTimers();
    try {
      const credentialVerifier = vi.fn(async () => {});
      const callback = vi.fn(async () => {});
      const operation = withTemporaryRuntimeRole({
        config: config(),
        worker: {
          begin: async (transactionCallback) =>
            transactionCallback({ unsafe: async () => [] }),
        },
        recoverRuntimeRole: vi.fn(async () => {}),
        callback,
        credentialVerifier,
        passwordFactory: () => `Aa9!${"q".repeat(40)}`,
      });

      await vi.advanceTimersByTimeAsync(124_999);
      expect(credentialVerifier).not.toHaveBeenCalled();
      expect(callback).not.toHaveBeenCalled();

      await vi.advanceTimersByTimeAsync(1);
      await operation;

      expect(credentialVerifier).toHaveBeenCalledOnce();
      expect(callback).toHaveBeenCalledOnce();
    } finally {
      vi.useRealTimers();
    }
  });

  it("binds an in-memory password and always restores the role", async () => {
    const calls = [];
    const events = [];
    const worker = {
      begin: async (callback) => {
        const result = await callback({
          unsafe: async (query, parameters) => {
            calls.push({ query, parameters });
            return [];
          },
        });
        events.push("altered");
        return result;
      },
      unsafe: async (query) => {
        calls.push({ query });
        return safeWorkerResult(query);
      },
    };
    const recoverRuntimeRole = vi.fn(async () => {});
    const credentialVerifier = vi.fn(async () => {
      events.push("authenticate");
    });
    const password = `Aa9!${"x".repeat(40)}`;
    const callbackFailure = new Error("synthetic route failure");
    const credentialPropagationWait = vi.fn(async (milliseconds) => {
      events.push(`wait-${milliseconds}`);
    });

    await expect(
      withTemporaryRuntimeRole({
        config: config(),
        worker,
        recoverRuntimeRole,
        callback: async ({ runtimeDatabaseUrl }) => {
          events.push("callback");
          expect(runtimeDatabaseUrl).toBe(runtimeUrl);
          throw callbackFailure;
        },
        credentialPropagationWait,
        credentialVerifier,
        passwordFactory: () => password,
      }),
    ).rejects.toBe(callbackFailure);

    const passwordCall = calls.find(
      ({ query }) => query === GREENFIELD_RUNTIME_ROLE_SQL.setup[0],
    );
    expect(passwordCall.query).not.toContain(password);
    expect(passwordCall.parameters).toEqual([password]);
    expect(recoverRuntimeRole).toHaveBeenCalledTimes(2);
    expect(credentialPropagationWait).toHaveBeenCalledOnce();
    expect(credentialPropagationWait).toHaveBeenCalledWith(125_000);
    expect(credentialVerifier).toHaveBeenCalledOnce();
    expect(credentialVerifier.mock.calls[0][0]).toMatchObject({
      credentialLabel: "temporary runtime credential",
      databaseUrl: runtimeUrl,
    });
    expect(events).toEqual([
      "altered",
      "wait-125000",
      "authenticate",
      "callback",
    ]);
  });

  it("uses the held-lock recovery before setup and after callback", async () => {
    const worker = {
      begin: async (callback) => callback({ unsafe: async () => [] }),
    };
    const recoverRuntimeRole = vi.fn(async () => {});
    const verifier = runtimeCredentialVerifier();

    await withTemporaryRuntimeRole({
      config: config(),
      worker,
      recoverRuntimeRole,
      callback: async () => {},
      credentialPropagationWait: vi.fn(async () => {}),
      credentialVerifier: verifier.credentialVerifier,
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
    const verifier = runtimeCredentialVerifier();

    const error = await withTemporaryRuntimeRole({
      config: config(),
      worker: {
        begin: async (callback) => callback({ unsafe: async () => [] }),
      },
      recoverRuntimeRole,
      callback: async () => {
        throw callbackFailure;
      },
      credentialPropagationWait: vi.fn(async () => {}),
      credentialVerifier: verifier.credentialVerifier,
      passwordFactory: () => `Aa9!${"z".repeat(40)}`,
    }).catch((caught) => caught);

    expect(error).toBeInstanceOf(AggregateError);
    expect(error.errors).toEqual([callbackFailure, recoveryFailure]);
  });

  it("stops after one temporary credential failure before fan-out", async () => {
    const wrongPassword = Object.assign(new Error("synthetic secret"), {
      code: "28P01",
    });
    const verifier = runtimeCredentialVerifier(wrongPassword);
    const recoverRuntimeRole = vi.fn(async () => {});
    const callback = vi.fn();

    const error = await withTemporaryRuntimeRole({
      config: config(),
      worker: {
        begin: async (transactionCallback) =>
          transactionCallback({ unsafe: async () => [] }),
      },
      recoverRuntimeRole,
      callback,
      credentialPropagationWait: vi.fn(async () => {}),
      credentialVerifier: verifier.credentialVerifier,
      passwordFactory: () => `Aa9!${"w".repeat(40)}`,
    }).catch((caught) => caught);

    expect(error.message).toBe(
      "Greenfield TEST temporary runtime credential could not authenticate",
    );
    expect(error.message).not.toContain("synthetic secret");
    expect(callback).not.toHaveBeenCalled();
    expect(verifier.credentialVerifier).toHaveBeenCalledOnce();
    expect(recoverRuntimeRole).toHaveBeenCalledTimes(2);
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

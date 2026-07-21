import { EventEmitter } from "node:events";

import { describe, expect, it, vi } from "vitest";

import {
  GREENFIELD_RUNTIME_ROLE_SQL,
  withGreenfieldTestLock,
} from "../../scripts/test-target-harness.mjs";
import {
  greenfieldChildEnvironment,
  stopGreenfieldOwnerAuthServer,
} from "../../scripts/test-target-auth-server.mjs";

const operatorSessionUrl = "postgresql://operator-session";
const operatorWorkerUrl = "postgresql://operator-worker";
const runtimeUrl =
  "postgresql://app_runtime.hzibzwhrwmljgjjdzspi:runtime-password@aws-1-eu-central-2.pooler.supabase.com:6543/postgres?sslmode=verify-full";
const CA_CERTIFICATE = "synthetic-ca-certificate";

function config() {
  return {
    apiUrl: "https://hzibzwhrwmljgjjdzspi.supabase.co/",
    projectRef: "hzibzwhrwmljgjjdzspi",
    getDatabaseCaCertificate: () => CA_CERTIFICATE,
    getOperatorSessionDatabaseUrl: () => operatorSessionUrl,
    getOperatorWorkerDatabaseUrl: () => operatorWorkerUrl,
    getPublishableKey: () => `sb_publishable_${"p".repeat(32)}`,
    getRuntimeDatabaseUrl: () => runtimeUrl,
  };
}

describe("greenfield TEST advisory lock", () => {
  it("initializes the schema before runtime credential preparation and callback", async () => {
    const events = [];
    const lockClient = {
      unsafe: vi.fn(async (query) => {
        if (query.includes("pg_try_advisory_lock")) {
          events.push("lock");
          return [{ acquired: true }];
        }
        if (query.includes("pg_advisory_unlock")) {
          events.push("unlock");
          return [{ released: true }];
        }
        if (query.includes("runtime_role.rolcanlogin")) {
          events.push("final-lock-state");
          return [
            {
              attributes_are_safe: true,
              credential_is_missing: false,
              credential_is_safe: true,
              has_unsafe_access: false,
              has_unsafe_membership: false,
              rolcanlogin: true,
            },
          ];
        }
        if (query.includes("pg_stat_activity")) return [{ active: 0 }];
        throw new Error(`unexpected SQL: ${query}`);
      }),
      release: vi.fn(async () => {}),
    };
    const lockPool = {
      reserve: vi.fn(async () => lockClient),
      end: vi.fn(async () => {}),
    };
    const worker = {
      end: vi.fn(async () => {}),
      unsafe: vi.fn(async (query) => {
        if (query === GREENFIELD_RUNTIME_ROLE_SQL.reapProbe) {
          events.push("reap-probe");
          return [{ candidates: 0, terminated: 0 }];
        }
        if (query.includes("runtime_role.rolcanlogin")) {
          events.push("worker-credential-state");
          return [
            {
              attributes_are_safe: true,
              credential_is_missing: false,
              credential_is_safe: true,
              has_unsafe_access: false,
              has_unsafe_membership: false,
              rolcanlogin: true,
            },
          ];
        }
        if (query.includes("pg_stat_activity")) return [{ active: 0 }];
        throw new Error(`unexpected worker SQL: ${query}`);
      }),
    };
    const clientFactory = vi
      .fn()
      .mockReturnValueOnce(lockPool)
      .mockReturnValueOnce(worker);
    const initialize = vi.fn(async ({ worker: actualWorker }) => {
      expect(actualWorker).toBe(worker);
      events.push("initialize");
      return { bootstrapped: true };
    });
    const callback = vi.fn(async ({ initialization }) => {
      events.push("callback");
      expect(initialization).toEqual({ bootstrapped: true });
      return "complete";
    });

    await expect(
      withGreenfieldTestLock(config(), callback, {
        clientFactory,
        credentialPropagationWait: async () => events.push("wait"),
        credentialVerifier: async () => events.push("credential-probe"),
        initialize,
      }),
    ).resolves.toBe("complete");
    expect(events.indexOf("initialize")).toBeLessThan(events.indexOf("wait"));
    expect(events.indexOf("wait")).toBeLessThan(
      events.indexOf("credential-probe"),
    );
    expect(events.indexOf("credential-probe")).toBeLessThan(
      events.indexOf("callback"),
    );
    expect(events.indexOf("callback")).toBeLessThan(
      events.indexOf("final-lock-state"),
    );
    expect(events.indexOf("final-lock-state")).toBeLessThan(
      events.indexOf("unlock"),
    );
    expect(lockClient.begin).toBeUndefined();
  });

  it("closes the lock pool when worker initialization fails", async () => {
    const lockPool = { reserve: vi.fn(), end: vi.fn(async () => {}) };
    const failure = new Error("synthetic worker init failure");
    const clientFactory = vi
      .fn()
      .mockReturnValueOnce(lockPool)
      .mockImplementationOnce(() => {
        throw failure;
      });

    await expect(
      withGreenfieldTestLock(config(), vi.fn(), { clientFactory }),
    ).rejects.toBe(failure);
    expect(lockPool.reserve).not.toHaveBeenCalled();
    expect(lockPool.end).toHaveBeenCalledWith({ timeout: 5 });
  });

  it("fails immediately when another runner holds the lock", async () => {
    const callback = vi.fn();
    const lockClient = {
      unsafe: vi.fn(async () => [{ acquired: false }]),
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
      withGreenfieldTestLock(config(), callback, { clientFactory }),
    ).rejects.toThrow("already locked");
    expect(callback).not.toHaveBeenCalled();
    expect(worker.end).toHaveBeenCalledOnce();
    expect(lockClient.release).toHaveBeenCalledOnce();
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
  it("passes only the direct runtime credential and required safe settings", () => {
    const env = greenfieldChildEnvironment(config(), runtimeUrl);
    expect(env).toMatchObject({
      APP_ENV: "preview",
      EMAIL_TRANSPORT: "fake",
      NEXT_PUBLIC_APP_ENV: "preview",
      SUPABASE_DATABASE_CA_CERTIFICATE: CA_CERTIFICATE,
      SUPABASE_DATABASE_URL: runtimeUrl,
      SUPABASE_PROJECT_REF: "hzibzwhrwmljgjjdzspi",
      VERCEL_ENV: "preview",
    });
    expect(JSON.stringify(env)).not.toContain("operator-session");
  });
});

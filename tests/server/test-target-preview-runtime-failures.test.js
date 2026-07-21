import { describe, expect, it, vi } from "vitest";

import {
  GREENFIELD_RUNTIME_ROLE_SQL,
  withGreenfieldTestLock,
} from "../../scripts/test-target-harness.mjs";

function config() {
  return {
    getDatabaseCaCertificate: () => "ca",
    getOperatorSessionDatabaseUrl: () => "postgresql://operator-session",
    getOperatorWorkerDatabaseUrl: () => "postgresql://operator-worker",
    getRuntimeDatabaseUrl: () =>
      "postgresql://app_runtime.ref:runtime-password@pooler.test:6543/postgres?sslmode=verify-full",
  };
}

function state({ cleanupFailures = {}, credentialFailure = null } = {}) {
  const runtimeQuery = async (query) => {
    if (query === GREENFIELD_RUNTIME_ROLE_SQL.state) {
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
    if (query === GREENFIELD_RUNTIME_ROLE_SQL.sessions) return [{ active: 0 }];
    return [];
  };
  const lockClient = {
    release: vi.fn(async () => {
      if (cleanupFailures.release) throw cleanupFailures.release;
    }),
    unsafe: vi.fn(async (query) => {
      if (query.includes("pg_try_advisory_lock")) return [{ acquired: true }];
      if (query.includes("pg_advisory_unlock")) {
        if (cleanupFailures.unlock) throw cleanupFailures.unlock;
        return [{ released: true }];
      }
      return runtimeQuery(query);
    }),
  };
  const lockPool = {
    reserve: vi.fn(async () => lockClient),
    end: vi.fn(async () => {
      if (cleanupFailures.pool) throw cleanupFailures.pool;
    }),
  };
  const worker = {
    end: vi.fn(async () => {
      if (cleanupFailures.worker) throw cleanupFailures.worker;
    }),
    unsafe: vi.fn(runtimeQuery),
  };
  return {
    credentialPropagationWait: vi.fn(async () => {}),
    credentialVerifier: vi.fn(async () => {
      if (credentialFailure) throw credentialFailure;
    }),
    clientFactory: vi
      .fn()
      .mockReturnValueOnce(lockPool)
      .mockReturnValueOnce(worker),
    lockClient,
    lockPool,
    worker,
  };
}

describe("greenfield TEST direct runtime failures", () => {
  it("does not retry or expose a credential transport failure", async () => {
    const secret = "protected-runtime-secret";
    const harness = state({ credentialFailure: new Error(secret) });
    const callback = vi.fn();
    const error = await withGreenfieldTestLock(
      config(),
      callback,
      harness,
    ).catch((caught) => caught);
    expect(error.message).toBe(
      "Greenfield TEST durable runtime credential could not authenticate",
    );
    expect(error.message).not.toContain(secret);
    expect(harness.credentialVerifier).toHaveBeenCalledOnce();
    expect(callback).not.toHaveBeenCalled();
  });

  it("preserves the operation failure while attempting every finalizer", async () => {
    const operationFailure = new Error("synthetic operation failure");
    const cleanupFailure = () => new Error("synthetic cleanup failure");
    const harness = state({
      cleanupFailures: {
        pool: cleanupFailure(),
        release: cleanupFailure(),
        unlock: cleanupFailure(),
        worker: cleanupFailure(),
      },
    });
    const error = await withGreenfieldTestLock(
      config(),
      async () => {
        throw operationFailure;
      },
      harness,
    ).catch((caught) => caught);
    expect(error).toBeInstanceOf(AggregateError);
    expect(error.errors[0]).toBe(operationFailure);
    expect(error.errors).toHaveLength(5);
    expect(harness.worker.end).toHaveBeenCalledOnce();
    expect(harness.lockClient.release).toHaveBeenCalledOnce();
    expect(harness.lockPool.end).toHaveBeenCalledOnce();
  });
});

import { describe, expect, it, vi } from "vitest";

import {
  GREENFIELD_RUNTIME_ROLE_SQL,
  withGreenfieldTestLock,
} from "../../scripts/test-target-harness.mjs";
import {
  RUNTIME_CREDENTIAL_INITIAL_PROPAGATION_DELAY_MS,
  RUNTIME_CREDENTIAL_POST_PROBE_DRAIN_DELAY_MS,
  drainGreenfieldRuntimeSessions,
  verifyRuntimeCredential,
} from "../../scripts/test-target-runtime-role.mjs";

const runtimeUrl =
  "postgresql://app_runtime.hzibzwhrwmljgjjdzspi:Runtime%21Password-Only-In-Memory-12345@aws-1-eu-central-2.pooler.supabase.com:6543/postgres?sslmode=verify-full";

function config() {
  return {
    getDatabaseCaCertificate: () => "synthetic-ca",
    getOperatorSessionDatabaseUrl: () => "postgresql://operator-session",
    getOperatorWorkerDatabaseUrl: () => "postgresql://operator-worker",
    getRuntimeDatabaseUrl: () => runtimeUrl,
  };
}

function harness({
  missingCredential = false,
  postProbeSessions = 0,
  sessions = 0,
} = {}) {
  let credentialIsMissing = missingCredential;
  let activeSessions = sessions;
  const events = [];
  const runtimeQuery = async (query, source) => {
    if (query === GREENFIELD_RUNTIME_ROLE_SQL.state) {
      events.push(`${source}-state`);
      return [
        {
          attributes_are_safe: true,
          credential_is_missing: credentialIsMissing,
          credential_is_safe: !credentialIsMissing,
          has_unsafe_access: false,
          has_unsafe_membership: false,
          rolcanlogin: true,
        },
      ];
    }
    if (query === GREENFIELD_RUNTIME_ROLE_SQL.sessions) {
      events.push(`${source}-sessions`);
      return [{ active: activeSessions }];
    }
    return [];
  };
  const lockClient = {
    release: vi.fn(async () => events.push("lock-release")),
    unsafe: vi.fn(async (query) => {
      if (query.includes("pg_try_advisory_lock")) {
        events.push("lock");
        return [{ acquired: true }];
      }
      if (query.includes("pg_advisory_unlock")) {
        events.push("unlock");
        return [{ released: true }];
      }
      return runtimeQuery(query, "lock");
    }),
  };
  const lockPool = {
    end: vi.fn(async () => events.push("lock-pool-end")),
    reserve: vi.fn(async () => lockClient),
  };
  const worker = {
    begin: vi.fn(async (callback) =>
      callback({
        unsafe: vi.fn(async (query) => {
          events.push(
            query === GREENFIELD_RUNTIME_ROLE_SQL.provision[1]
              ? "provision"
              : "configure",
          );
          if (query === GREENFIELD_RUNTIME_ROLE_SQL.provision[1])
            credentialIsMissing = false;
          return [];
        }),
      }),
    ),
    end: vi.fn(async () => events.push("worker-end")),
    unsafe: vi.fn((query) => runtimeQuery(query, "worker")),
  };
  const clientFactory = vi
    .fn()
    .mockReturnValueOnce(lockPool)
    .mockReturnValueOnce(worker);
  const credentialVerifier = vi.fn(async () => {
    events.push("probe");
    activeSessions = postProbeSessions;
  });
  return {
    clientFactory,
    credentialVerifier,
    events,
    lockClient,
    lockPool,
    worker,
  };
}

describe("greenfield TEST durable direct runtime", () => {
  it("keeps a measured safety margin beyond the Supavisor idle timeout", () => {
    expect(RUNTIME_CREDENTIAL_INITIAL_PROPAGATION_DELAY_MS).toBe(125_000);
    expect(RUNTIME_CREDENTIAL_POST_PROBE_DRAIN_DELAY_MS).toBe(150_000);
    expect(RUNTIME_CREDENTIAL_POST_PROBE_DRAIN_DELAY_MS).toBeGreaterThan(
      RUNTIME_CREDENTIAL_INITIAL_PROPAGATION_DELAY_MS,
    );
  });

  it("authenticates and authorizes as app_runtime without SET ROLE", () => {
    expect(GREENFIELD_RUNTIME_ROLE_SQL.authenticate).toContain(
      "session_user = 'app_runtime'",
    );
    expect(GREENFIELD_RUNTIME_ROLE_SQL.authenticate).toContain(
      "current_user = 'app_runtime'",
    );
    expect(GREENFIELD_RUNTIME_ROLE_SQL.assume).toBe("select true where false");
    expect(GREENFIELD_RUNTIME_ROLE_SQL.authorize).toContain(
      "gioia_private.get_cutover_write_state()",
    );
    expect(JSON.stringify(GREENFIELD_RUNTIME_ROLE_SQL)).not.toContain(
      "app_runtime_login",
    );
  });

  it("contains no backend termination path", () => {
    expect(JSON.stringify(GREENFIELD_RUNTIME_ROLE_SQL)).not.toContain(
      "pg_terminate_backend",
    );
  });

  it("excludes only the exact provider-owned idle Supavisor backend", () => {
    expect(GREENFIELD_RUNTIME_ROLE_SQL.sessions).toContain(
      "application_name = 'Supavisor'",
    );
    expect(GREENFIELD_RUNTIME_ROLE_SQL.sessions).toContain("state = 'idle'");
    expect(GREENFIELD_RUNTIME_ROLE_SQL.sessions).toContain(
      "wait_event_type = 'Client'",
    );
    expect(GREENFIELD_RUNTIME_ROLE_SQL.sessions).toContain(
      "wait_event = 'ClientRead'",
    );
    expect(GREENFIELD_RUNTIME_ROLE_SQL.sessions).toContain(
      "application_name = 'gioia_public_api'",
    );
  });

  it("waits for post-server Supavisor drain before proving zero sessions", async () => {
    const state = harness();
    const wait = vi.fn(async () => state.events.push("server-drain-wait"));

    await drainGreenfieldRuntimeSessions(state.worker, wait);

    expect(wait).toHaveBeenCalledOnce();
    expect(wait).toHaveBeenCalledWith(
      RUNTIME_CREDENTIAL_POST_PROBE_DRAIN_DELAY_MS,
    );
    expect(state.events).toEqual([
      "server-drain-wait",
      "worker-state",
      "worker-sessions",
    ]);
  });

  it("uses an existing credential after one quiet period and no lifecycle mutation", async () => {
    const state = harness();
    const wait = vi.fn(async () => {});
    const drainWait = vi.fn(async () => {});
    const callback = vi.fn(async () => "ok");

    await expect(
      withGreenfieldTestLock(config(), callback, {
        clientFactory: state.clientFactory,
        credentialDrainWait: drainWait,
        credentialPropagationWait: wait,
        credentialVerifier: state.credentialVerifier,
      }),
    ).resolves.toBe("ok");

    expect(wait).toHaveBeenCalledOnce();
    expect(wait).toHaveBeenCalledWith(
      RUNTIME_CREDENTIAL_INITIAL_PROPAGATION_DELAY_MS,
    );
    expect(drainWait).toHaveBeenCalledOnce();
    expect(drainWait).toHaveBeenCalledWith(
      RUNTIME_CREDENTIAL_POST_PROBE_DRAIN_DELAY_MS,
    );
    expect(state.lockClient.begin).toBeUndefined();
    expect(state.worker.begin).not.toHaveBeenCalled();
    expect(state.credentialVerifier).toHaveBeenCalledOnce();
    expect(callback).toHaveBeenCalledWith({ worker: state.worker });
    expect(
      state.credentialVerifier.mock.calls.every(
        ([request]) => request.databaseUrl === runtimeUrl,
      ),
    ).toBe(true);
  });

  it("provisions once, waits, authenticates once, then drains", async () => {
    const state = harness({ missingCredential: true });
    const wait = vi.fn(async () => state.events.push("propagation-wait"));
    const drainWait = vi.fn(async () => state.events.push("drain-wait"));
    const callback = vi.fn(async () => state.events.push("callback"));

    await withGreenfieldTestLock(config(), callback, {
      clientFactory: state.clientFactory,
      credentialDrainWait: drainWait,
      credentialPropagationWait: wait,
      credentialVerifier: state.credentialVerifier,
    });

    expect(state.lockClient.begin).toBeUndefined();
    expect(state.worker.begin).toHaveBeenCalledOnce();
    expect(state.events).toEqual([
      "lock",
      "worker-state",
      "worker-sessions",
      "worker-state",
      "configure",
      "provision",
      "worker-state",
      "worker-sessions",
      "propagation-wait",
      "worker-state",
      "worker-sessions",
      "probe",
      "drain-wait",
      "worker-state",
      "worker-sessions",
      "callback",
      "lock-state",
      "lock-sessions",
      "worker-end",
      "unlock",
      "lock-release",
      "lock-pool-end",
    ]);
    expect(wait).toHaveBeenCalledOnce();
    expect(wait).toHaveBeenCalledWith(
      RUNTIME_CREDENTIAL_INITIAL_PROPAGATION_DELAY_MS,
    );
    expect(state.credentialVerifier).toHaveBeenCalledOnce();
    expect(drainWait).toHaveBeenCalledOnce();
    expect(drainWait).toHaveBeenCalledWith(
      RUNTIME_CREDENTIAL_POST_PROBE_DRAIN_DELAY_MS,
    );
    expect(state.worker.end).toHaveBeenCalledOnce();
    expect(state.lockClient.release).toHaveBeenCalledOnce();
    expect(state.lockPool.end).toHaveBeenCalledOnce();
  });

  it("drains Supavisor after the probe before callback", async () => {
    const state = harness();
    const drainWait = vi.fn(async () => state.events.push("drain-wait"));
    const callback = vi.fn(async () => {
      state.events.push("callback");
      return "complete";
    });

    await expect(
      withGreenfieldTestLock(config(), callback, {
        clientFactory: state.clientFactory,
        credentialDrainWait: drainWait,
        credentialPropagationWait: vi.fn(async () => {}),
        credentialVerifier: state.credentialVerifier,
      }),
    ).resolves.toBe("complete");

    expect(state.credentialVerifier).toHaveBeenCalledOnce();
    expect(state.events.indexOf("probe")).toBeLessThan(
      state.events.indexOf("drain-wait"),
    );
    expect(state.events.indexOf("drain-wait")).toBeLessThan(
      state.events.indexOf("callback"),
    );
  });

  it("fails after the drain when an unknown application session remains", async () => {
    const state = harness({ postProbeSessions: 1 });
    const drainWait = vi.fn(async () => state.events.push("drain-wait"));
    const callback = vi.fn();

    await expect(
      withGreenfieldTestLock(config(), callback, {
        clientFactory: state.clientFactory,
        credentialDrainWait: drainWait,
        credentialPropagationWait: vi.fn(async () => {}),
        credentialVerifier: state.credentialVerifier,
      }),
    ).rejects.toThrow("runtime sessions must be zero");

    expect(state.credentialVerifier).toHaveBeenCalledOnce();
    expect(drainWait).toHaveBeenCalledOnce();
    expect(callback).not.toHaveBeenCalled();
  });

  it("refuses active runtime sessions before provisioning or callback", async () => {
    const state = harness({ sessions: 1 });
    const callback = vi.fn();

    await expect(
      withGreenfieldTestLock(config(), callback, {
        clientFactory: state.clientFactory,
        credentialVerifier: vi.fn(async () => {}),
      }),
    ).rejects.toThrow("runtime sessions must be zero");
    expect(callback).not.toHaveBeenCalled();
    expect(state.lockClient.begin).toBeUndefined();
    expect(state.worker.begin).not.toHaveBeenCalled();
  });

  it("redacts and does not retry a direct credential failure", async () => {
    const verifier = vi.fn(async () => {
      throw new Error("synthetic secret provider failure");
    });
    const error = await verifyRuntimeCredential(config(), verifier).catch(
      (caught) => caught,
    );
    expect(error.message).toBe(
      "Greenfield TEST durable runtime credential could not authenticate",
    );
    expect(error.message).not.toContain("synthetic secret");
    expect(verifier).toHaveBeenCalledOnce();
  });
});

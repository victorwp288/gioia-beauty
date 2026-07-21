import { describe, expect, it, vi } from "vitest";

import {
  GREENFIELD_RUNTIME_ROLE_SQL,
  withGreenfieldTestLock,
} from "../../scripts/test-target-harness.mjs";
import {
  RUNTIME_CREDENTIAL_INITIAL_PROPAGATION_DELAY_MS,
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
  probeCandidates = 1,
  probeSessionCount = probeCandidates,
  reapFailure,
  reaped = probeCandidates === 1 ? 1 : 0,
  sessions = 0,
} = {}) {
  let credentialIsMissing = missingCredential;
  let activeSessions = sessions;
  let activeProbeCandidates = 0;
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
    if (query === GREENFIELD_RUNTIME_ROLE_SQL.reapProbe) {
      events.push(`${source}-reap-probe`);
      if (reapFailure) throw reapFailure;
      const terminated = Math.min(reaped, activeProbeCandidates);
      activeSessions = Math.max(0, activeSessions - terminated);
      return [
        {
          candidates: activeProbeCandidates,
          terminated,
        },
      ];
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
    activeProbeCandidates = probeCandidates;
    activeSessions += probeSessionCount;
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

  it("scopes probe cleanup to one exact app_runtime probe backend", () => {
    const reap = GREENFIELD_RUNTIME_ROLE_SQL.reapProbe;
    expect(reap).toContain("activity.datname = pg_catalog.current_database()");
    expect(reap).toContain("activity.usename = 'app_runtime'");
    expect(reap).toContain(
      "activity.application_name = 'gioia_greenfield_credential_probe'",
    );
    expect(reap).toContain("activity.backend_type = 'client backend'");
    expect(reap).toContain("activity.pid <> pg_catalog.pg_backend_pid()");
    expect(reap).toContain("where counts.candidates <= 1");
    expect(reap).toContain("pg_catalog.pg_terminate_backend(");
    expect(reap).toContain("2000::bigint");
    expect(reap).not.toContain("gioia_public_api");
    expect(reap).not.toMatch(/usename\s*=\s*'app_runtime'\s+or/iu);
  });

  it("uses an existing credential after one quiet period and no lifecycle mutation", async () => {
    const state = harness();
    const wait = vi.fn(async () => {});
    const callback = vi.fn(async () => "ok");

    await expect(
      withGreenfieldTestLock(config(), callback, {
        clientFactory: state.clientFactory,
        credentialPropagationWait: wait,
        credentialVerifier: state.credentialVerifier,
      }),
    ).resolves.toBe("ok");

    expect(wait).toHaveBeenCalledOnce();
    expect(wait).toHaveBeenCalledWith(
      RUNTIME_CREDENTIAL_INITIAL_PROPAGATION_DELAY_MS,
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

  it("provisions a missing credential once, waits once, then authenticates", async () => {
    const state = harness({ missingCredential: true });
    const wait = vi.fn(async () => state.events.push("wait"));
    const callback = vi.fn(async () => state.events.push("callback"));

    await withGreenfieldTestLock(config(), callback, {
      clientFactory: state.clientFactory,
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
      "wait",
      "worker-state",
      "worker-sessions",
      "probe",
      "worker-reap-probe",
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
    expect(state.worker.end).toHaveBeenCalledOnce();
    expect(state.lockClient.release).toHaveBeenCalledOnce();
    expect(state.lockPool.end).toHaveBeenCalledOnce();
  });

  it("reaps only one exact successful probe before callback", async () => {
    const state = harness();
    const callback = vi.fn(async () => {
      state.events.push("callback");
      return "complete";
    });

    await expect(
      withGreenfieldTestLock(config(), callback, {
        clientFactory: state.clientFactory,
        credentialPropagationWait: vi.fn(async () => {}),
        credentialVerifier: state.credentialVerifier,
      }),
    ).resolves.toBe("complete");

    expect(state.credentialVerifier).toHaveBeenCalledOnce();
    expect(state.worker.unsafe).toHaveBeenCalledWith(
      GREENFIELD_RUNTIME_ROLE_SQL.reapProbe,
    );
    expect(state.events.indexOf("probe")).toBeLessThan(
      state.events.indexOf("worker-reap-probe"),
    );
    expect(state.events.indexOf("worker-reap-probe")).toBeLessThan(
      state.events.indexOf("callback"),
    );
  });

  it.each([
    {
      name: "ambiguous exact probes",
      options: { probeCandidates: 2, probeSessionCount: 2 },
      message: "credential probe backend did not reconcile",
    },
    {
      name: "an unrecognized application session",
      options: { probeCandidates: 0, probeSessionCount: 1 },
      message: "runtime sessions must be zero",
    },
    {
      name: "a failed termination that remains active",
      options: { probeCandidates: 1, reaped: 0 },
      message: "runtime sessions must be zero",
    },
  ])("fails closed after one probe for $name", async ({ message, options }) => {
    const state = harness(options);
    const callback = vi.fn();

    await expect(
      withGreenfieldTestLock(config(), callback, {
        clientFactory: state.clientFactory,
        credentialPropagationWait: vi.fn(async () => {}),
        credentialVerifier: state.credentialVerifier,
      }),
    ).rejects.toThrow(message);

    expect(state.credentialVerifier).toHaveBeenCalledOnce();
    expect(callback).not.toHaveBeenCalled();
  });

  it("fails generically when exact probe cleanup errors without retrying auth", async () => {
    const secret = "synthetic cleanup detail";
    const state = harness({ reapFailure: new Error(secret) });
    const callback = vi.fn();
    const error = await withGreenfieldTestLock(config(), callback, {
      clientFactory: state.clientFactory,
      credentialPropagationWait: vi.fn(async () => {}),
      credentialVerifier: state.credentialVerifier,
    }).catch((caught) => caught);

    expect(error.message).toBe(
      "Greenfield TEST credential probe backend did not reconcile",
    );
    expect(error.message).not.toContain(secret);
    expect(state.credentialVerifier).toHaveBeenCalledOnce();
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

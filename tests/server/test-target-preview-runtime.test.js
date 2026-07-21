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

function harness({ missingCredential = false, sessions = 0 } = {}) {
  let credentialIsMissing = missingCredential;
  const events = [];
  const lockClient = {
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
    release: vi.fn(async () => {}),
    unsafe: vi.fn(async (query) => {
      if (query.includes("pg_try_advisory_lock")) return [{ acquired: true }];
      if (query.includes("pg_advisory_unlock")) return [{ released: true }];
      if (query === GREENFIELD_RUNTIME_ROLE_SQL.state) {
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
        return [{ active: sessions }];
      }
      return [];
    }),
  };
  const lockPool = {
    end: vi.fn(async () => {}),
    reserve: vi.fn(async () => lockClient),
  };
  const worker = { end: vi.fn(async () => {}) };
  const clientFactory = vi
    .fn()
    .mockReturnValueOnce(lockPool)
    .mockReturnValueOnce(worker);
  return { clientFactory, events, lockClient, worker };
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

  it("uses an existing credential after one quiet period and no lifecycle mutation", async () => {
    const state = harness();
    const wait = vi.fn(async () => {});
    const verifier = vi.fn(async () => {});
    const callback = vi.fn(async () => "ok");

    await expect(
      withGreenfieldTestLock(config(), callback, {
        clientFactory: state.clientFactory,
        credentialPropagationWait: wait,
        credentialVerifier: verifier,
      }),
    ).resolves.toBe("ok");

    expect(wait).toHaveBeenCalledOnce();
    expect(wait).toHaveBeenCalledWith(
      RUNTIME_CREDENTIAL_INITIAL_PROPAGATION_DELAY_MS,
    );
    expect(state.lockClient.begin).not.toHaveBeenCalled();
    expect(verifier).toHaveBeenCalledOnce();
    expect(callback).toHaveBeenCalledWith({ worker: state.worker });
    expect(
      verifier.mock.calls.every(
        ([request]) => request.databaseUrl === runtimeUrl,
      ),
    ).toBe(true);
  });

  it("provisions a missing credential once, waits once, then authenticates", async () => {
    const state = harness({ missingCredential: true });
    const wait = vi.fn(async () => {});
    const verifier = vi.fn(async () => {});

    await withGreenfieldTestLock(config(), async () => {}, {
      clientFactory: state.clientFactory,
      credentialPropagationWait: wait,
      credentialVerifier: verifier,
    });

    expect(state.lockClient.begin).toHaveBeenCalledOnce();
    expect(state.events).toEqual(["configure", "provision"]);
    expect(wait).toHaveBeenCalledOnce();
    expect(wait).toHaveBeenCalledWith(
      RUNTIME_CREDENTIAL_INITIAL_PROPAGATION_DELAY_MS,
    );
    expect(verifier).toHaveBeenCalledOnce();
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
    expect(state.lockClient.begin).not.toHaveBeenCalled();
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

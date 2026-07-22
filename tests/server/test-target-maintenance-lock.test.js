import { describe, expect, it, vi } from "vitest";

import { withRemoteTestMaintenanceOperator } from "../../scripts/test-target-maintenance-operator.mjs";

const PROJECT_REF = "hzibzwhrwmljgjjdzspi";
const HOST = "aws-1-eu-central-2.pooler.supabase.com";
const PASSWORD = "Synthetic-Operator-Password-For-Unit-Tests-123";
const FREEZE_ID = "10000000-0000-4000-8000-000000000001";
const RUN_ID = "20000000-0000-4000-8000-000000000001";
const GRANT_ID = "30000000-0000-4000-8000-000000000001";
const IDEMPOTENCY_KEY = "40000000-0000-4000-8000-000000000001";

function config() {
  const base = `postgresql://postgres.${PROJECT_REF}:${PASSWORD}@${HOST}`;
  return {
    appEnv: "operator",
    environment: "test",
    projectRef: PROJECT_REF,
    poolerHost: HOST,
    poolerRegion: "eu-central-2",
    operatorSessionPort: 5432,
    operatorWorkerPort: 6543,
    sslmode: "verify-full",
    getOperatorSessionDatabaseUrl: () =>
      `${base}:5432/postgres?sslmode=verify-full`,
    getOperatorWorkerDatabaseUrl: () =>
      `${base}:6543/postgres?sslmode=verify-full`,
    getDatabaseCaCertificate: () => "synthetic pinned test CA",
  };
}

describe("remote TEST maintenance advisory lock lifecycle", () => {
  it("holds the shared lock, proves clean boundaries, and closes both pools", async () => {
    const events = [];
    const lockClient = {
      unsafe: vi.fn(async (query) => {
        if (query.includes("pg_try_advisory_lock")) {
          events.push("lock");
          return [{ acquired: true }];
        }
        events.push("unlock");
        return [{ released: true }];
      }),
      release: vi.fn(async () => events.push("release")),
    };
    const lockPool = {
      reserve: vi.fn(async () => lockClient),
      end: vi.fn(async () => events.push("lock-pool-end")),
    };
    const workerUnsafe = vi.fn(async (query) =>
      query.includes("cutover_write_control")
        ? [
            {
              mode: "open",
              freeze_id: null,
              version: 1,
              active_runs: 0,
              issued_grants: 0,
            },
          ]
        : [],
    );
    const worker = {
      unsafe: workerUnsafe,
      begin: vi.fn(async (callback) => callback({ unsafe: workerUnsafe })),
      end: vi.fn(async () => events.push("worker-end")),
    };
    const clientFactory = vi
      .fn()
      .mockReturnValueOnce(lockPool)
      .mockReturnValueOnce(worker);

    await expect(
      withRemoteTestMaintenanceOperator(
        config(),
        async (operator) => {
          events.push("callback");
          expect(await operator.assertOpen()).toMatchObject({ mode: "open" });
          return "complete";
        },
        { clientFactory },
      ),
    ).resolves.toBe("complete");
    expect(events).toEqual([
      "lock",
      "callback",
      "worker-end",
      "unlock",
      "release",
      "lock-pool-end",
    ]);
    expect(worker.begin).toHaveBeenCalledTimes(3);
  });

  it("does not create a worker when the TEST target is already locked", async () => {
    const lockClient = {
      unsafe: vi.fn(async () => [{ acquired: false }]),
      release: vi.fn(async () => {}),
    };
    const lockPool = {
      reserve: vi.fn(async () => lockClient),
      end: vi.fn(async () => {}),
    };
    const clientFactory = vi.fn(() => lockPool);
    const callback = vi.fn();
    await expect(
      withRemoteTestMaintenanceOperator(config(), callback, { clientFactory }),
    ).rejects.toMatchObject({ code: "REMOTE_TEST_TARGET_ALREADY_LOCKED" });
    expect(clientFactory).toHaveBeenCalledOnce();
    expect(callback).not.toHaveBeenCalled();
    expect(lockClient.release).toHaveBeenCalledOnce();
    expect(lockPool.end).toHaveBeenCalledWith({ timeout: 5 });
  });

  it("restores only callback-owned canary state before unlocking on failure", async () => {
    const events = [];
    const state = {
      mode: "open",
      freezeId: null,
      version: 1,
      runStatus: null,
      grantStatus: null,
    };
    const lockClient = {
      unsafe: vi.fn(async (query) => {
        if (query.includes("pg_try_advisory_lock")) {
          events.push("lock");
          return [{ acquired: true }];
        }
        events.push("unlock");
        return [{ released: true }];
      }),
      release: vi.fn(async () => events.push("release")),
    };
    const lockPool = {
      reserve: vi.fn(async () => lockClient),
      end: vi.fn(async () => events.push("lock-pool-end")),
    };
    const workerUnsafe = vi.fn(async (query, parameters) => {
      if (query.includes("cutover_write_control as control")) {
        events.push(`state:${state.mode}`);
        return [
          {
            mode: state.mode,
            freeze_id: state.freezeId,
            version: state.version,
            active_runs: state.runStatus === "active" ? 1 : 0,
            issued_grants: state.grantStatus === "issued" ? 1 : 0,
          },
        ];
      }
      if (query.includes("begin_cutover_write_freeze")) {
        events.push("freeze");
        Object.assign(state, {
          mode: "frozen",
          freezeId: FREEZE_ID,
          version: 2,
        });
        return [{ freeze_id: FREEZE_ID, version: 2 }];
      }
      if (query.includes("begin_cutover_canary_run")) {
        events.push("begin-run");
        state.runStatus = "active";
        return [{ run_id: RUN_ID }];
      }
      if (query.includes("issue_cutover_canary_grant")) {
        events.push("issue-grant");
        state.grantStatus = "issued";
        return [{ grant_id: GRANT_ID }];
      }
      if (query.includes("left join gioia_private.cutover_canary_grants")) {
        events.push("exact-cleanup-read");
        expect(parameters[0]).toBe(RUN_ID);
        return [
          {
            freeze_id: FREEZE_ID,
            run_status: state.runStatus,
            grant_id: GRANT_ID,
            grant_status: state.grantStatus,
          },
        ];
      }
      if (query.includes("revoke_cutover_canary_grant")) {
        events.push("revoke-grant");
        expect(parameters).toEqual([GRANT_ID]);
        state.grantStatus = "revoked";
        return [];
      }
      if (query.includes("reconcile_cutover_canary_run")) {
        events.push("reconcile-run");
        expect(parameters).toEqual([RUN_ID]);
        state.runStatus = "reconciled";
        return [];
      }
      if (query.includes("enter_cutover_owner_reconcile")) {
        events.push("owner-reconcile");
        Object.assign(state, { mode: "owner_reconcile", version: 3 });
        return [{ version: 3 }];
      }
      if (query.includes("complete_cutover_unfreeze")) {
        events.push("unfreeze");
        Object.assign(state, { mode: "open", freezeId: null, version: 4 });
        return [{ version: 4 }];
      }
      return [];
    });
    const worker = {
      unsafe: workerUnsafe,
      begin: vi.fn(async (callback) => callback({ unsafe: workerUnsafe })),
      end: vi.fn(async () => events.push("worker-end")),
    };
    const clientFactory = vi
      .fn()
      .mockReturnValueOnce(lockPool)
      .mockReturnValueOnce(worker);

    await expect(
      withRemoteTestMaintenanceOperator(
        config(),
        async (operator) => {
          const freeze = await operator.freeze("REMOTE_TEST_FREEZE");
          const run = await operator.beginCanaryRun({
            freezeId: freeze.freezeId,
            labelCode: "REMOTE_TEST_RUN",
          });
          await operator.issueCanaryGrant({
            runId: run.runId,
            operation: "public_booking",
            idempotencyKey: IDEMPOTENCY_KEY,
            requestFingerprint: Buffer.alloc(32, 9),
          });
          throw new Error("injected callback failure");
        },
        { clientFactory },
      ),
    ).rejects.toThrow("injected callback failure");

    expect(state).toEqual({
      mode: "open",
      freezeId: null,
      version: 4,
      runStatus: "reconciled",
      grantStatus: "revoked",
    });
    expect(events).toEqual([
      "lock",
      "state:open",
      "freeze",
      "begin-run",
      "issue-grant",
      "exact-cleanup-read",
      "revoke-grant",
      "reconcile-run",
      "owner-reconcile",
      "unfreeze",
      "state:open",
      "worker-end",
      "unlock",
      "release",
      "lock-pool-end",
    ]);
  });
});

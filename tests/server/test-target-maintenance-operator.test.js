import { createHash } from "node:crypto";

import { describe, expect, it, vi } from "vitest";

import {
  TestTargetMaintenanceOperatorError,
  assertRemoteTestMaintenanceConfig,
  createRemoteTestMaintenanceOperator,
} from "../../scripts/test-target-maintenance-operator.mjs";

const PROJECT_REF = "hzibzwhrwmljgjjdzspi";
const HOST = "aws-1-eu-central-2.pooler.supabase.com";
const PASSWORD = "Synthetic-Operator-Password-For-Unit-Tests-123";
const FREEZE_ID = "10000000-0000-4000-8000-000000000001";
const RUN_ID = "20000000-0000-4000-8000-000000000001";
const GRANT_ID = "30000000-0000-4000-8000-000000000001";
const SECOND_GRANT_ID = "30000000-0000-4000-8000-000000000002";
const IDEMPOTENCY_KEY = "40000000-0000-4000-8000-000000000001";
const CA = "synthetic pinned test CA";

function config(overrides = {}) {
  const session =
    `postgresql://postgres.${PROJECT_REF}:${PASSWORD}@${HOST}` +
    ":5432/postgres?sslmode=verify-full";
  const worker =
    `postgresql://postgres.${PROJECT_REF}:${PASSWORD}@${HOST}` +
    ":6543/postgres?sslmode=verify-full";
  return {
    appEnv: "operator",
    environment: "test",
    projectRef: PROJECT_REF,
    poolerHost: HOST,
    poolerRegion: "eu-central-2",
    operatorSessionPort: 5432,
    operatorWorkerPort: 6543,
    sslmode: "verify-full",
    getOperatorSessionDatabaseUrl: () => session,
    getOperatorWorkerDatabaseUrl: () => worker,
    getDatabaseCaCertificate: () => CA,
    ...overrides,
  };
}

function transactionDatabase(resolver) {
  const unsafe = vi.fn(resolver);
  return {
    database: {
      unsafe,
      begin: vi.fn(async (callback) => callback({ unsafe })),
    },
    unsafe,
  };
}

describe("remote TEST maintenance operator target boundary", () => {
  it("accepts only the exact replacement TEST operator DSNs", () => {
    expect(assertRemoteTestMaintenanceConfig(config())).toMatchObject({
      certificate: CA,
      sessionDatabaseUrl: expect.stringContaining(`${HOST}:5432/postgres`),
      workerDatabaseUrl: expect.stringContaining(`${HOST}:6543/postgres`),
    });
    for (const candidate of [
      config({ environment: "production" }),
      config({ projectRef: "production-project" }),
      config({ getOperatorWorkerDatabaseUrl: () => "postgresql://wrong" }),
      config({
        getOperatorWorkerDatabaseUrl: () =>
          `postgresql://postgres.${PROJECT_REF}:different-password@${HOST}` +
          ":6543/postgres?sslmode=verify-full",
      }),
    ]) {
      expect(() => assertRemoteTestMaintenanceConfig(candidate)).toThrow(
        TestTargetMaintenanceOperatorError,
      );
    }
  });

  it("hashes canary tokens and permits only the minimum operation set", async () => {
    const { database, unsafe } = transactionDatabase(async (query) => {
      if (query.includes("issue_cutover_canary_grant")) {
        return [{ grant_id: GRANT_ID }];
      }
      return [];
    });
    const tokenMaterial = Buffer.alloc(32, 7);
    const operator = createRemoteTestMaintenanceOperator({
      database,
      config: config(),
      now: () => new Date("2035-01-01T12:00:00.000Z"),
      tokenBytes: () => tokenMaterial,
    });
    const fingerprint = Buffer.alloc(32, 9);
    const grant = await operator.issueCanaryGrant({
      runId: RUN_ID,
      operation: "public_booking",
      idempotencyKey: IDEMPOTENCY_KEY,
      requestFingerprint: fingerprint,
    });
    expect(grant.token).toMatch(/^[A-Za-z0-9_-]{43}$/u);
    const call = unsafe.mock.calls.find(([query]) =>
      query.includes("issue_cutover_canary_grant"),
    );
    expect(call[1][1]).toEqual(
      createHash("sha256").update(grant.token).digest(),
    );
    expect(call[1][4]).toEqual(fingerprint);
    expect(call[1][4]).not.toBe(fingerprint);
    expect(JSON.stringify(call[1])).not.toContain(grant.token);

    await expect(
      operator.issueCanaryGrant({
        runId: RUN_ID,
        operation: "owner_update_appointment_details",
        idempotencyKey: IDEMPOTENCY_KEY,
        requestFingerprint: fingerprint,
      }),
    ).rejects.toMatchObject({ code: "INVALID_CANARY_OPERATION" });
  });

  it("runs every lifecycle mutation inside a bounded transaction", async () => {
    const { database, unsafe } = transactionDatabase(async (query) => {
      if (query.includes("begin_cutover_write_freeze")) {
        return [{ freeze_id: FREEZE_ID, version: 2 }];
      }
      if (query.includes("begin_cutover_canary_run")) {
        return [{ run_id: RUN_ID }];
      }
      if (query.includes("enter_cutover_owner_reconcile"))
        return [{ version: 3 }];
      if (query.includes("complete_cutover_unfreeze")) return [{ version: 4 }];
      return [];
    });
    const operator = createRemoteTestMaintenanceOperator({
      database,
      config: config(),
      now: () => new Date("2035-01-01T12:00:00.000Z"),
    });
    await expect(operator.freeze("REMOTE_TEST_FREEZE")).resolves.toEqual({
      freezeId: FREEZE_ID,
      version: 2,
    });
    await expect(
      operator.beginCanaryRun({ freezeId: FREEZE_ID, labelCode: "REMOTE_RUN" }),
    ).resolves.toMatchObject({ runId: RUN_ID });
    await operator.revokeCanaryGrant(GRANT_ID);
    await operator.reconcileCanaryRun(RUN_ID);
    await expect(
      operator.enterOwnerReconcile({
        freezeId: FREEZE_ID,
        expectedVersion: 2,
        reasonCode: "REMOTE_RECONCILE",
      }),
    ).resolves.toBe(3);
    await expect(
      operator.unfreeze({
        freezeId: FREEZE_ID,
        expectedVersion: 3,
        reasonCode: "REMOTE_ACCEPTED",
      }),
    ).resolves.toBe(4);
    expect(database.begin).toHaveBeenCalledTimes(6);
    expect(
      unsafe.mock.calls.filter(([query]) => query.includes("set local ")),
    ).toHaveLength(18);
  });

  it("cleans only the exact named run and complete grant set", async () => {
    const { database, unsafe } = transactionDatabase(async (query) => {
      if (query.includes("left join gioia_private.cutover_canary_grants")) {
        return [
          {
            freeze_id: FREEZE_ID,
            run_status: "active",
            grant_id: GRANT_ID,
            grant_status: "issued",
          },
          {
            freeze_id: FREEZE_ID,
            run_status: "active",
            grant_id: SECOND_GRANT_ID,
            grant_status: "used",
          },
        ];
      }
      return [];
    });
    const operator = createRemoteTestMaintenanceOperator({
      database,
      config: config(),
    });
    await expect(
      operator.cleanupCanaryRun({
        freezeId: FREEZE_ID,
        runId: RUN_ID,
        grantIds: [SECOND_GRANT_ID, GRANT_ID],
      }),
    ).resolves.toEqual({
      runId: RUN_ID,
      reconciled: true,
      alreadyReconciled: false,
      revokedGrantIds: [GRANT_ID],
    });
    expect(
      unsafe.mock.calls.some(
        ([query, parameters]) =>
          query.includes("revoke_cutover_canary_grant") &&
          parameters.includes(GRANT_ID),
      ),
    ).toBe(true);
    expect(
      unsafe.mock.calls.some(([query]) =>
        query.includes("reconcile_cutover_canary_run"),
      ),
    ).toBe(true);
  });

  it("rejects cleanup when an unlisted grant exists", async () => {
    const { database, unsafe } = transactionDatabase(async (query) => {
      if (query.includes("left join gioia_private.cutover_canary_grants")) {
        return [GRANT_ID, SECOND_GRANT_ID].map((grantId) => ({
          freeze_id: FREEZE_ID,
          run_status: "active",
          grant_id: grantId,
          grant_status: "issued",
        }));
      }
      return [];
    });
    const operator = createRemoteTestMaintenanceOperator({
      database,
      config: config(),
    });
    await expect(
      operator.cleanupCanaryRun({
        freezeId: FREEZE_ID,
        runId: RUN_ID,
        grantIds: [GRANT_ID],
      }),
    ).rejects.toMatchObject({ code: "CANARY_CLEANUP_TARGET_MISMATCH" });
    expect(
      unsafe.mock.calls.some(([query]) =>
        query.includes("revoke_cutover_canary_grant"),
      ),
    ).toBe(false);
  });
});

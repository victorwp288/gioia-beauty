import postgres from "postgres";

import {
  createTestTargetDatabaseClient,
  endTestTargetDatabaseClient,
} from "./test-target-database-client.mjs";
import {
  TestTargetMaintenanceOperatorError,
  assertRemoteTestMaintenanceConfig,
} from "./test-target-maintenance-contract.mjs";
import { createRemoteTestMaintenanceOperator } from "./test-target-maintenance-operations.mjs";
import {
  GREENFIELD_TEST_LOCK_SQL,
  GREENFIELD_TEST_UNLOCK_SQL,
} from "./test-target-harness.mjs";

export {
  TestTargetMaintenanceOperatorError,
  assertRemoteTestMaintenanceConfig,
  createRemoteTestMaintenanceOperator,
};

async function cleanupAttempt(errors, message, operation) {
  try {
    await operation();
  } catch {
    errors.push(new Error(message));
  }
}

function createTrackedOperator(operator) {
  let freeze;
  const runs = new Map();

  function ownedFreeze(freezeId, expectedVersion) {
    if (
      !freeze ||
      freeze.freezeId !== freezeId ||
      freeze.version !== expectedVersion
    ) {
      throw new TestTargetMaintenanceOperatorError(
        "REMOTE_TEST_OPERATOR_OWNERSHIP_MISMATCH",
      );
    }
  }

  function ownedRun(runId) {
    const run = runs.get(runId);
    if (!run) {
      throw new TestTargetMaintenanceOperatorError(
        "REMOTE_TEST_OPERATOR_OWNERSHIP_MISMATCH",
      );
    }
    return run;
  }

  const tracked = Object.freeze({
    readState: operator.readState,
    assertOpen: operator.assertOpen,
    async freeze(reasonCode) {
      if (freeze) {
        throw new TestTargetMaintenanceOperatorError(
          "REMOTE_TEST_OPERATOR_FREEZE_ALREADY_OWNED",
        );
      }
      const created = await operator.freeze(reasonCode);
      freeze = Object.freeze({ ...created, mode: "frozen" });
      return created;
    },
    async beginCanaryRun(input) {
      if (!freeze || input?.freezeId !== freeze.freezeId) {
        throw new TestTargetMaintenanceOperatorError(
          "REMOTE_TEST_OPERATOR_OWNERSHIP_MISMATCH",
        );
      }
      const run = await operator.beginCanaryRun(input);
      runs.set(run.runId, new Set());
      return run;
    },
    async issueCanaryGrant(input) {
      const grants = ownedRun(input?.runId);
      const grant = await operator.issueCanaryGrant(input);
      grants.add(grant.grantId);
      return grant;
    },
    async revokeCanaryGrant(grantId) {
      const owned = [...runs.values()].some((grants) => grants.has(grantId));
      if (!owned) {
        throw new TestTargetMaintenanceOperatorError(
          "REMOTE_TEST_OPERATOR_OWNERSHIP_MISMATCH",
        );
      }
      return operator.revokeCanaryGrant(grantId);
    },
    async reconcileCanaryRun(runId) {
      ownedRun(runId);
      await operator.reconcileCanaryRun(runId);
      runs.delete(runId);
    },
    async cleanupCanaryRun(input) {
      const grants = ownedRun(input?.runId);
      if (
        !freeze ||
        input?.freezeId !== freeze.freezeId ||
        !Array.isArray(input?.grantIds) ||
        input.grantIds.length !== grants.size ||
        input.grantIds.some((grantId) => !grants.has(grantId))
      ) {
        throw new TestTargetMaintenanceOperatorError(
          "REMOTE_TEST_OPERATOR_OWNERSHIP_MISMATCH",
        );
      }
      const result = await operator.cleanupCanaryRun(input);
      runs.delete(input.runId);
      return result;
    },
    async enterOwnerReconcile(input) {
      ownedFreeze(input?.freezeId, input?.expectedVersion);
      const version = await operator.enterOwnerReconcile(input);
      freeze = Object.freeze({
        freezeId: freeze.freezeId,
        version,
        mode: "owner_reconcile",
      });
      return version;
    },
    async unfreeze(input) {
      ownedFreeze(input?.freezeId, input?.expectedVersion);
      const version = await operator.unfreeze(input);
      freeze = undefined;
      return version;
    },
  });

  return Object.freeze({
    operator: tracked,
    async restoreOwnedState() {
      if (!freeze) return operator.assertOpen();
      for (const [runId, grantIds] of runs) {
        await operator.cleanupCanaryRun({
          freezeId: freeze.freezeId,
          runId,
          grantIds: [...grantIds],
        });
        runs.delete(runId);
      }
      if (freeze.mode === "frozen") {
        const ownerVersion = await operator.enterOwnerReconcile({
          freezeId: freeze.freezeId,
          expectedVersion: freeze.version,
          reasonCode: "REMOTE_TEST_FAILURE_RECONCILE",
        });
        freeze = Object.freeze({
          freezeId: freeze.freezeId,
          version: ownerVersion,
          mode: "owner_reconcile",
        });
      }
      await operator.unfreeze({
        freezeId: freeze.freezeId,
        expectedVersion: freeze.version,
        reasonCode: "REMOTE_TEST_FAILURE_UNFREEZE",
      });
      freeze = undefined;
      return operator.assertOpen();
    },
  });
}

export async function withRemoteTestMaintenanceOperator(
  config,
  callback,
  { clientFactory = postgres, now, tokenBytes } = {},
) {
  if (typeof callback !== "function") {
    throw new TestTargetMaintenanceOperatorError(
      "REMOTE_TEST_OPERATOR_CALLBACK_REQUIRED",
    );
  }
  const target = assertRemoteTestMaintenanceConfig(config);
  const lockPool = createTestTargetDatabaseClient(
    target.sessionDatabaseUrl,
    1,
    { caCertificate: target.certificate, clientFactory, persistent: true },
  );
  let lockClient;
  let worker;
  let locked = false;
  let operationError;
  let result;
  let trackedOperator;
  try {
    lockClient = await lockPool.reserve();
    const [lock, ...extra] = await lockClient.unsafe(GREENFIELD_TEST_LOCK_SQL);
    if (lock?.acquired !== true || extra.length !== 0) {
      throw new TestTargetMaintenanceOperatorError(
        "REMOTE_TEST_TARGET_ALREADY_LOCKED",
      );
    }
    locked = true;
    worker = createTestTargetDatabaseClient(target.workerDatabaseUrl, 1, {
      caCertificate: target.certificate,
      clientFactory,
    });
    const operator = createRemoteTestMaintenanceOperator({
      database: worker,
      config,
      now,
      tokenBytes,
    });
    trackedOperator = createTrackedOperator(operator);
    await operator.assertOpen();
    result = await callback(trackedOperator.operator);
    await operator.assertOpen();
  } catch (error) {
    operationError = error;
  }

  const cleanupErrors = [];
  if (operationError && trackedOperator) {
    await cleanupAttempt(
      cleanupErrors,
      "Remote TEST callback-owned maintenance state was not restored",
      () => trackedOperator.restoreOwnedState(),
    );
  }
  if (worker) {
    await cleanupAttempt(
      cleanupErrors,
      "Remote TEST maintenance worker did not close",
      () => endTestTargetDatabaseClient(worker),
    );
  }
  if (locked && lockClient) {
    await cleanupAttempt(
      cleanupErrors,
      "Remote TEST maintenance lock was not released",
      async () => {
        const [release, ...extra] = await lockClient.unsafe(
          GREENFIELD_TEST_UNLOCK_SQL,
        );
        if (release?.released !== true || extra.length !== 0) throw new Error();
      },
    );
  }
  if (lockClient) {
    await cleanupAttempt(
      cleanupErrors,
      "Remote TEST maintenance lock client was not released",
      () => lockClient.release(),
    );
  }
  await cleanupAttempt(
    cleanupErrors,
    "Remote TEST maintenance lock pool did not close",
    () => endTestTargetDatabaseClient(lockPool),
  );

  if (operationError && cleanupErrors.length > 0) {
    throw new AggregateError(
      [operationError, ...cleanupErrors],
      "Remote TEST maintenance operation and cleanup failed",
    );
  }
  if (operationError) throw operationError;
  if (cleanupErrors.length === 1) throw cleanupErrors[0];
  if (cleanupErrors.length > 1) {
    throw new AggregateError(
      cleanupErrors,
      "Remote TEST maintenance cleanup failed",
    );
  }
  return result;
}

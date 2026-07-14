import postgres from "postgres";

import {
  createTestTargetDatabaseClient,
  endTestTargetDatabaseClient,
} from "./test-target-database-client.mjs";
import { withSuspendedPreviewCredential } from "./test-target-runtime-role.mjs";

export {
  GREENFIELD_PREVIEW_ROLE_SQL,
  GREENFIELD_RUNTIME_ROLE_SQL,
  withTemporaryRuntimeRole,
} from "./test-target-runtime-role.mjs";

const GLOBAL_LOCK_SQL =
  "select pg_catalog.pg_try_advisory_lock(7102026, 72135538) as acquired";
const GLOBAL_UNLOCK_SQL =
  "select pg_catalog.pg_advisory_unlock(7102026, 72135538) as released";

export const GREENFIELD_TEST_LOCK_SQL = GLOBAL_LOCK_SQL;
export const GREENFIELD_TEST_UNLOCK_SQL = GLOBAL_UNLOCK_SQL;

async function attemptCleanup(errors, message, operation) {
  try {
    await operation();
  } catch {
    errors.push(new Error(message));
  }
}

export async function withGreenfieldTestLock(
  config,
  callback,
  { clientFactory = postgres } = {},
) {
  if (typeof callback !== "function") {
    throw new Error("Greenfield TEST lock requires a callback");
  }
  const caCertificate = config.getDatabaseCaCertificate();
  const lockPool = createTestTargetDatabaseClient(
    config.getOperatorSessionDatabaseUrl(),
    1,
    { caCertificate, clientFactory, persistent: true },
  );
  const worker = createTestTargetDatabaseClient(
    config.getOperatorWorkerDatabaseUrl(),
    21,
    { caCertificate, clientFactory },
  );
  let lockClient;
  let locked = false;
  let operationError;
  let result;
  try {
    lockClient = await lockPool.reserve();
    const [lock, ...extra] = await lockClient.unsafe(GLOBAL_LOCK_SQL);
    if (lock?.acquired !== true || extra.length !== 0) {
      throw new Error("Greenfield TEST target is already locked");
    }
    locked = true;
    result = await withSuspendedPreviewCredential(
      lockClient,
      config,
      clientFactory,
      ({ recoverRuntimeRole }) => callback({ worker, recoverRuntimeRole }),
    );
  } catch (error) {
    operationError = error;
  }

  const cleanupErrors = [];
  await attemptCleanup(
    cleanupErrors,
    "Greenfield TEST worker did not close",
    () => endTestTargetDatabaseClient(worker),
  );
  if (locked && lockClient) {
    await attemptCleanup(
      cleanupErrors,
      "Greenfield TEST target lock was not released",
      async () => {
        const [release, ...extra] = await lockClient.unsafe(GLOBAL_UNLOCK_SQL);
        if (release?.released !== true || extra.length !== 0) throw new Error();
      },
    );
  }
  if (lockClient) {
    await attemptCleanup(
      cleanupErrors,
      "Greenfield TEST lock client was not released",
      () => lockClient.release(),
    );
  }
  await attemptCleanup(
    cleanupErrors,
    "Greenfield TEST lock pool did not close",
    () => endTestTargetDatabaseClient(lockPool),
  );

  if (operationError && cleanupErrors.length > 0) {
    throw new AggregateError(
      [operationError, ...cleanupErrors],
      "Greenfield TEST operation and cleanup failed",
    );
  }
  if (operationError) throw operationError;
  if (cleanupErrors.length === 1) throw cleanupErrors[0];
  if (cleanupErrors.length > 1) {
    throw new AggregateError(cleanupErrors, "Greenfield TEST cleanup failed");
  }
  return result;
}

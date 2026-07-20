import { chmod, mkdir, mkdtemp, rm, rmdir, statfs } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import {
  LOCAL_POSTGRES_MINIMUM_FREE_BYTES,
  parseLocalSupabaseStatus,
  redactedConnection,
} from "./local-postgres-clone-contract.mjs";
import {
  LocalPostgresCloneError,
  assertLocalCloneAbsent,
  assertPostgres17Toolchain,
  assertMatchingDatabaseIdentity,
  createLocalClone,
  dropLocalClone,
  dumpLocalSource,
  queryLocalClone,
  readPostgresDatabaseIdentity,
  readLocalSupabaseStatus,
  restoreLocalClone,
} from "./local-postgres-clone-process.mjs";

const DEFAULT_STORAGE = Object.freeze({
  chmod,
  mkdir,
  mkdtemp,
  rm,
  rmdir,
  statfs,
});
export const LOCAL_POSTGRES_CLONE_LOCK_PATH = path.join(
  tmpdir(),
  "gioia-phase5-postgres-clone.lock",
);

function availableBytes(fileSystem) {
  const blockSize = Number(fileSystem.bsize);
  const availableBlocks = Number(fileSystem.bavail);
  return blockSize * availableBlocks;
}

async function assertScratchDisk(minimumFreeBytes, storage) {
  const root = tmpdir();
  const free = availableBytes(await storage.statfs(root));
  if (!Number.isSafeInteger(free) || free < minimumFreeBytes) {
    throw new LocalPostgresCloneError("scratch disk preflight");
  }
}

async function attemptCleanup(errors, operation, message) {
  try {
    await operation();
  } catch {
    errors.push(new LocalPostgresCloneError(message));
  }
}

export async function withLocalPostgresLogicalClone(
  callback,
  {
    environment = process.env,
    execFileImpl,
    minimumFreeBytes = LOCAL_POSTGRES_MINIMUM_FREE_BYTES,
    storage = DEFAULT_STORAGE,
    status: suppliedStatus,
  } = {},
) {
  if (typeof callback !== "function") {
    throw new Error("Local Postgres clone requires an inspection callback");
  }
  if (
    !Number.isSafeInteger(minimumFreeBytes) ||
    minimumFreeBytes < LOCAL_POSTGRES_MINIMUM_FREE_BYTES
  ) {
    throw new Error("Local Postgres clone disk floor cannot be weakened");
  }
  let connection;
  let lockHeld = false;
  let workspace;
  let operationError;
  let callbackValue;
  let cloneOwned = false;
  let dump;
  let identity;
  try {
    await storage.mkdir(LOCAL_POSTGRES_CLONE_LOCK_PATH, { mode: 0o700 });
    lockHeld = true;
    const status =
      suppliedStatus ?? (await readLocalSupabaseStatus(execFileImpl));
    connection = parseLocalSupabaseStatus(status, environment);
    await assertScratchDisk(minimumFreeBytes, storage);
    const candidateWorkspace = await storage.mkdtemp(
      path.join(tmpdir(), "gioia-pg-clone-"),
    );
    if (path.dirname(candidateWorkspace) !== tmpdir()) {
      throw new LocalPostgresCloneError("scratch directory validation");
    }
    workspace = candidateWorkspace;
    await storage.chmod(workspace, 0o700);
    const sourceIdentity = await assertPostgres17Toolchain(
      connection,
      execFileImpl,
    );
    await assertLocalCloneAbsent(connection, execFileImpl);
    const dumpPath = path.join(workspace, "source.dump");
    const tocPath = path.join(workspace, "source.toc");
    dump = await dumpLocalSource(connection, dumpPath, tocPath, execFileImpl);
    const restoreCapturedDump = async () => {
      if (cloneOwned) {
        await dropLocalClone(connection, execFileImpl);
        cloneOwned = false;
      }
      await createLocalClone(connection, execFileImpl);
      cloneOwned = true;
      await restoreLocalClone(connection, dumpPath, execFileImpl);
      const restoredIdentity = await readPostgresDatabaseIdentity(
        connection,
        connection.targetDatabase,
        execFileImpl,
      );
      assertMatchingDatabaseIdentity(sourceIdentity, restoredIdentity);
      return restoredIdentity;
    };
    const cloneIdentity = await restoreCapturedDump();
    identity = Object.freeze({ clone: cloneIdentity, source: sourceIdentity });
    let inspectionOpen = true;
    let inspectionOperationActive = false;
    const runInspectionOperation = async (operation) => {
      if (!inspectionOpen || inspectionOperationActive) {
        throw new LocalPostgresCloneError("clone inspection scope");
      }
      inspectionOperationActive = true;
      try {
        return await operation();
      } finally {
        inspectionOperationActive = false;
      }
    };
    const inspect = Object.freeze({
      connection: redactedConnection(connection, connection.targetDatabase),
      dump,
      identity,
      query: (sql) =>
        runInspectionOperation(() =>
          queryLocalClone(connection, sql, execFileImpl),
        ),
      recreate: () => runInspectionOperation(restoreCapturedDump),
    });
    try {
      callbackValue = await callback(inspect);
    } finally {
      inspectionOpen = false;
    }
  } catch (error) {
    operationError =
      error instanceof LocalPostgresCloneError
        ? error
        : new LocalPostgresCloneError("orchestration");
  }

  const cleanupErrors = [];
  if (connection && cloneOwned) {
    await attemptCleanup(
      cleanupErrors,
      () => dropLocalClone(connection, execFileImpl),
      "scratch database cleanup",
    );
  }
  if (workspace) {
    await attemptCleanup(
      cleanupErrors,
      () => storage.rm(workspace, { recursive: true, force: true }),
      "scratch directory cleanup",
    );
  }
  if (lockHeld) {
    await attemptCleanup(
      cleanupErrors,
      () => storage.rmdir(LOCAL_POSTGRES_CLONE_LOCK_PATH),
      "clone run-lock cleanup",
    );
  }
  if (operationError && cleanupErrors.length > 0) {
    throw new AggregateError(
      [operationError, ...cleanupErrors],
      "Local Postgres clone and cleanup failed",
    );
  }
  if (operationError) throw operationError;
  if (cleanupErrors.length === 1) throw cleanupErrors[0];
  if (cleanupErrors.length > 1) {
    throw new AggregateError(
      cleanupErrors,
      "Local Postgres clone cleanup failed",
    );
  }
  return Object.freeze({
    connection: redactedConnection(connection, connection.targetDatabase),
    dump,
    identity,
    value: callbackValue,
  });
}

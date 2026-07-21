import { randomBytes } from "node:crypto";

import {
  createTestTargetDatabaseClient,
  endTestTargetDatabaseClient,
} from "./test-target-database-client.mjs";
import {
  PREVIEW_ROLE_AUTHORIZE_SQL,
  PREVIEW_ROLE_AUTHENTICATE_SQL,
  PREVIEW_ROLE_ASSUME_SQL,
  PREVIEW_ROLE_RESTORE_SQL,
  RUNTIME_PASSWORD_CONFIG_SQL,
  RUNTIME_ROLE_ALTER_SQL,
  RUNTIME_ROLE_DISABLE_SQL,
  RUNTIME_ROLE_GRANT_SQL,
  RUNTIME_ROLE_REVOKE_SQL,
  RUNTIME_ROLE_STATE_SQL,
  RUNTIME_SESSION_STATE_SQL,
  RUNTIME_SESSION_TERMINATE_SQL,
} from "./test-target-runtime-role-sql.mjs";

const PREVIEW_AUTH_ATTEMPTS = 2;
const PREVIEW_AUTH_RETRY_DELAY_MS = 1_000;
const PREVIEW_AUTH_TIMEOUT_MS = 15_000;
const INVALID_PASSWORD_CODE = "28P01";

export {
  GREENFIELD_PREVIEW_ROLE_SQL,
  GREENFIELD_RUNTIME_ROLE_SQL,
} from "./test-target-runtime-role-sql.mjs";

async function runtimeRoleState(sql) {
  const [state, ...extra] = await sql.unsafe(RUNTIME_ROLE_STATE_SQL);
  if (!state || extra.length !== 0) {
    throw new Error("Greenfield TEST runtime role state is invalid");
  }
  return state;
}

function isSafeRuntimeRole(state, canLogin) {
  return (
    state.rolcanlogin === canLogin &&
    state.attributes_are_safe === true &&
    state.credential_is_safe === true &&
    !state.has_unsafe_membership &&
    !state.has_unsafe_access
  );
}

function isCredentialRefreshFailure(error) {
  return error instanceof Error && error.code === INVALID_PASSWORD_CODE;
}

async function assertRuntimeRoleState(sql, canLogin, message) {
  if (!isSafeRuntimeRole(await runtimeRoleState(sql), canLogin)) {
    throw new Error(message);
  }
}

async function terminateRuntimeSessions(sql) {
  const terminated = await sql.unsafe(RUNTIME_SESSION_TERMINATE_SQL);
  if (terminated.some((row) => row.terminated !== true)) {
    throw new Error("Greenfield TEST runtime sessions could not be terminated");
  }
  const deadline = Date.now() + 5_000;
  while (Date.now() < deadline) {
    const [state, ...extra] = await sql.unsafe(RUNTIME_SESSION_STATE_SQL);
    if (!state || extra.length !== 0) {
      throw new Error("Greenfield TEST runtime session state is invalid");
    }
    if (Number(state.active) === 0) return;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error("Greenfield TEST runtime sessions remain active");
}

async function suspendRuntimeRole(sql) {
  const errors = [];
  const attempt = async (operation) => {
    try {
      await operation();
    } catch (error) {
      errors.push(error);
    }
  };
  await attempt(() => sql.unsafe(RUNTIME_ROLE_DISABLE_SQL));
  await attempt(() => terminateRuntimeSessions(sql));
  await attempt(() => sql.unsafe(RUNTIME_ROLE_REVOKE_SQL));
  await attempt(() =>
    assertRuntimeRoleState(
      sql,
      false,
      "Greenfield TEST runtime role was not suspended",
    ),
  );
  await attempt(() => terminateRuntimeSessions(sql));
  if (errors.length === 1) throw errors[0];
  if (errors.length > 1) {
    throw new AggregateError(
      errors,
      "Greenfield TEST runtime role containment failed",
    );
  }
}

async function authenticatePreviewClient(client) {
  let timeout;
  try {
    return await Promise.race([
      client.begin(async (transaction) => {
        const [identity, ...extraIdentity] = await transaction.unsafe(
          PREVIEW_ROLE_AUTHENTICATE_SQL,
        );
        if (identity?.authorized !== true || extraIdentity.length !== 0) {
          return [{ authorized: false }];
        }
        await transaction.unsafe(PREVIEW_ROLE_ASSUME_SQL);
        return transaction.unsafe(PREVIEW_ROLE_AUTHORIZE_SQL);
      }),
      new Promise((_, reject) => {
        timeout = setTimeout(
          () =>
            reject(
              new Error("Greenfield TEST Preview authentication timed out"),
            ),
          PREVIEW_AUTH_TIMEOUT_MS,
        );
      }),
    ]);
  } finally {
    clearTimeout(timeout);
  }
}

export async function verifyPreviewCredential(config, clientFactory) {
  const authenticationError = () =>
    new Error(
      "Greenfield TEST durable Preview credential could not authenticate",
    );
  for (let attempt = 0; attempt < PREVIEW_AUTH_ATTEMPTS; attempt += 1) {
    let client;
    try {
      client = createTestTargetDatabaseClient(
        config.getPreviewRuntimeDatabaseUrl(),
        1,
        {
          caCertificate: config.getDatabaseCaCertificate(),
          clientFactory,
        },
      );
    } catch {
      throw authenticationError();
    }

    let credentialRefreshFailure = false;
    let authenticationFailure = false;
    let unauthorized = false;
    try {
      const [authorization, ...extra] = await authenticatePreviewClient(client);
      unauthorized = authorization?.authorized !== true || extra.length !== 0;
    } catch (error) {
      credentialRefreshFailure = isCredentialRefreshFailure(error);
      authenticationFailure = true;
    }

    let failedClose = false;
    try {
      await endTestTargetDatabaseClient(client);
    } catch {
      failedClose = true;
    }
    if ((authenticationFailure || unauthorized) && failedClose) {
      throw new AggregateError(
        [
          authenticationError(),
          new Error("Greenfield TEST verifier did not close"),
        ],
        "Greenfield TEST Preview authentication and verifier cleanup both failed",
      );
    }
    if (failedClose) {
      throw new Error("Greenfield TEST verifier did not close");
    }
    if (unauthorized) throw authenticationError();
    if (!authenticationFailure) return;
    if (credentialRefreshFailure && attempt < PREVIEW_AUTH_ATTEMPTS - 1) {
      await new Promise((resolve) =>
        setTimeout(resolve, PREVIEW_AUTH_RETRY_DELAY_MS),
      );
      continue;
    }
    throw authenticationError();
  }
  throw authenticationError();
}

async function restorePreviewRuntimeRole(sql, config, clientFactory) {
  const previewUrl = new URL(config.getPreviewRuntimeDatabaseUrl());
  const password = decodeURIComponent(previewUrl.password);
  try {
    await sql.begin(async (transaction) => {
      await transaction.unsafe(RUNTIME_PASSWORD_CONFIG_SQL, [password]);
      await transaction.unsafe(PREVIEW_ROLE_RESTORE_SQL);
      await transaction.unsafe(RUNTIME_ROLE_REVOKE_SQL);
    });
    await assertRuntimeRoleState(
      sql,
      true,
      "Greenfield TEST Preview runtime role is not exact",
    );
    await verifyPreviewCredential(config, clientFactory);
  } catch (restoreError) {
    try {
      await suspendRuntimeRole(sql);
    } catch (containmentError) {
      throw new AggregateError(
        [restoreError, containmentError],
        "Greenfield TEST Preview restoration and containment both failed",
      );
    }
    throw new Error(
      "Greenfield TEST durable Preview credential was not restored",
    );
  }
}

async function ensurePreviewCredential(sql, config, clientFactory) {
  const state = await runtimeRoleState(sql);
  if (
    state.attributes_are_safe !== true ||
    state.credential_is_safe !== true ||
    state.has_unsafe_membership ||
    state.has_unsafe_access ||
    typeof state.rolcanlogin !== "boolean"
  ) {
    const stateError = new Error(
      "Greenfield TEST Preview runtime role is not exact",
    );
    try {
      await suspendRuntimeRole(sql);
    } catch (containmentError) {
      throw new AggregateError(
        [stateError, containmentError],
        "Greenfield TEST unsafe Preview role containment failed",
      );
    }
    throw stateError;
  }
  if (state.rolcanlogin) {
    try {
      await verifyPreviewCredential(config, clientFactory);
      return;
    } catch (verificationError) {
      try {
        await suspendRuntimeRole(sql);
      } catch (containmentError) {
        throw new AggregateError(
          [verificationError, containmentError],
          "Greenfield TEST active Preview verification and containment both failed",
        );
      }
      throw verificationError;
    }
  }
  await restorePreviewRuntimeRole(sql, config, clientFactory);
}

export async function withSuspendedPreviewCredential(
  sql,
  config,
  clientFactory,
  callback,
) {
  await ensurePreviewCredential(sql, config, clientFactory);
  let operationError;
  let result;
  try {
    await suspendRuntimeRole(sql);
    result = await callback({
      recoverRuntimeRole: () => suspendRuntimeRole(sql),
    });
  } catch (error) {
    operationError = error;
  }

  try {
    await suspendRuntimeRole(sql);
  } catch (containmentError) {
    if (operationError) {
      throw new AggregateError(
        [operationError, containmentError],
        "Greenfield TEST operation and final containment both failed",
      );
    }
    throw containmentError;
  }

  try {
    await restorePreviewRuntimeRole(sql, config, clientFactory);
  } catch (restorationError) {
    if (operationError) {
      throw new AggregateError(
        [operationError, restorationError],
        "Greenfield TEST operation and Preview restoration both failed",
      );
    }
    throw restorationError;
  }
  if (operationError) throw operationError;
  return result;
}

function runtimePassword() {
  return `Aa9!${randomBytes(32).toString("base64url")}`;
}

export async function withTemporaryRuntimeRole({
  config,
  worker,
  recoverRuntimeRole,
  callback,
  passwordFactory = runtimePassword,
}) {
  if (
    typeof callback !== "function" ||
    typeof recoverRuntimeRole !== "function"
  ) {
    throw new Error("Greenfield TEST runtime role requires a callback");
  }
  await recoverRuntimeRole();
  const password = passwordFactory();
  const runtimeDatabaseUrl = config.deriveAppRuntimeDatabaseUrl(password);
  let operationError;
  let result;
  try {
    await worker.begin(async (transaction) => {
      await transaction.unsafe(RUNTIME_PASSWORD_CONFIG_SQL, [password]);
      await transaction.unsafe(RUNTIME_ROLE_GRANT_SQL);
      await transaction.unsafe(RUNTIME_ROLE_ALTER_SQL);
    });
    result = await callback({ runtimeDatabaseUrl });
  } catch (error) {
    operationError = error;
  }
  try {
    await recoverRuntimeRole();
  } catch (recoveryError) {
    if (operationError) {
      throw new AggregateError(
        [operationError, recoveryError],
        "Greenfield TEST temporary runtime operation and recovery both failed",
      );
    }
    throw recoveryError;
  }
  if (operationError) throw operationError;
  return result;
}

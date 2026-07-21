import { randomBytes } from "node:crypto";

import { verifyOneShotRuntimeCredential } from "./test-target-one-shot-credential.mjs";
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

export {
  GREENFIELD_PREVIEW_ROLE_SQL,
  GREENFIELD_RUNTIME_ROLE_SQL,
} from "./test-target-runtime-role-sql.mjs";

export const RUNTIME_CREDENTIAL_PROPAGATION_DELAY_MS = 125_000;

async function waitForRuntimeCredentialPropagation(milliseconds) {
  await new Promise((resolve) => setTimeout(resolve, milliseconds));
}

async function waitBeforeRuntimeCredentialAuthentication(
  credentialPropagationWait = waitForRuntimeCredentialPropagation,
) {
  // Supavisor can retain its credential circuit breaker for two minutes. One
  // quiet period avoids extending it. Without persisted rotation proof, an
  // active durable credential must be treated as newly propagated too.
  await credentialPropagationWait(RUNTIME_CREDENTIAL_PROPAGATION_DELAY_MS);
}

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

async function verifyRuntimeCredential(
  databaseUrl,
  caCertificate,
  credentialLabel,
  credentialVerifier = verifyOneShotRuntimeCredential,
) {
  try {
    await credentialVerifier({
      authenticateSql: PREVIEW_ROLE_AUTHENTICATE_SQL,
      authorizeSql: PREVIEW_ROLE_AUTHORIZE_SQL,
      assumeSql: PREVIEW_ROLE_ASSUME_SQL,
      caCertificate,
      credentialLabel,
      databaseUrl,
    });
  } catch {
    throw new Error(
      `Greenfield TEST ${credentialLabel} could not authenticate`,
    );
  }
}

export async function verifyPreviewCredential(config, credentialVerifier) {
  await verifyRuntimeCredential(
    config.getPreviewRuntimeDatabaseUrl(),
    config.getDatabaseCaCertificate(),
    "durable Preview credential",
    credentialVerifier,
  );
}

async function restorePreviewRuntimeRole(
  sql,
  config,
  credentialVerifier,
  credentialPropagationWait,
) {
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
    await waitBeforeRuntimeCredentialAuthentication(credentialPropagationWait);
    await verifyPreviewCredential(config, credentialVerifier);
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

async function ensurePreviewCredential(
  sql,
  config,
  credentialVerifier,
  credentialPropagationWait,
) {
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
      await waitBeforeRuntimeCredentialAuthentication(
        credentialPropagationWait,
      );
      await verifyPreviewCredential(config, credentialVerifier);
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
  await restorePreviewRuntimeRole(
    sql,
    config,
    credentialVerifier,
    credentialPropagationWait,
  );
}

export async function withSuspendedPreviewCredential(
  sql,
  config,
  credentialVerifier,
  callback,
  credentialPropagationWait,
) {
  await ensurePreviewCredential(
    sql,
    config,
    credentialVerifier,
    credentialPropagationWait,
  );
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

  if (operationError) throw operationError;

  await restorePreviewRuntimeRole(
    sql,
    config,
    credentialVerifier,
    credentialPropagationWait,
  );
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
  credentialVerifier,
  credentialPropagationWait,
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
    await waitBeforeRuntimeCredentialAuthentication(credentialPropagationWait);
    await verifyRuntimeCredential(
      runtimeDatabaseUrl,
      config.getDatabaseCaCertificate(),
      "temporary runtime credential",
      credentialVerifier,
    );
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

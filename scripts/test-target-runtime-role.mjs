import { verifyOneShotRuntimeCredential } from "./test-target-one-shot-credential.mjs";
import {
  RUNTIME_ROLE_AUTHENTICATE_SQL,
  RUNTIME_ROLE_AUTHORIZE_SQL,
  RUNTIME_ROLE_ASSUME_SQL,
  RUNTIME_CREDENTIAL_PROBE_REAP_SQL,
  RUNTIME_PASSWORD_CONFIG_SQL,
  RUNTIME_ROLE_PROVISION_SQL,
  RUNTIME_ROLE_STATE_SQL,
  RUNTIME_SESSION_STATE_SQL,
} from "./test-target-runtime-role-sql.mjs";

export {
  GREENFIELD_PREVIEW_ROLE_SQL,
  GREENFIELD_RUNTIME_ROLE_SQL,
} from "./test-target-runtime-role-sql.mjs";

export const RUNTIME_CREDENTIAL_INITIAL_PROPAGATION_DELAY_MS = 125_000;

async function singleRow(sql, statement, message) {
  const [row, ...extra] = await sql.unsafe(statement);
  if (!row || extra.length !== 0) throw new Error(message);
  return row;
}

async function runtimeRoleState(sql) {
  return singleRow(
    sql,
    RUNTIME_ROLE_STATE_SQL,
    "Greenfield TEST runtime role state is invalid",
  );
}

function exactRoleState(state, allowMissingCredential) {
  return (
    state.rolcanlogin === true &&
    state.attributes_are_safe === true &&
    (state.credential_is_safe === true ||
      (allowMissingCredential && state.credential_is_missing === true)) &&
    state.has_unsafe_membership === false &&
    state.has_unsafe_access === false
  );
}

export async function assertRuntimeRoleBoundary(
  sql,
  { allowMissingCredential = false } = {},
) {
  const state = await runtimeRoleState(sql);
  if (!exactRoleState(state, allowMissingCredential)) {
    throw new Error("Greenfield TEST runtime role is not exact");
  }

  const sessions = await singleRow(
    sql,
    RUNTIME_SESSION_STATE_SQL,
    "Greenfield TEST runtime session state is invalid",
  );
  if (Number(sessions.active) !== 0) {
    throw new Error("Greenfield TEST runtime sessions must be zero");
  }
}

function runtimePassword(config) {
  const url = new URL(config.getRuntimeDatabaseUrl());
  return decodeURIComponent(url.password);
}

export async function provisionRuntimeCredentialOnce(sql, config) {
  await assertRuntimeRoleBoundary(sql, { allowMissingCredential: true });
  const state = await runtimeRoleState(sql);
  if (state.credential_is_safe === true) return false;
  if (state.credential_is_missing !== true || typeof sql.begin !== "function") {
    throw new Error("Greenfield TEST runtime credential cannot be provisioned");
  }
  await sql.begin(async (transaction) => {
    await transaction.unsafe(RUNTIME_PASSWORD_CONFIG_SQL, [
      runtimePassword(config),
    ]);
    await transaction.unsafe(RUNTIME_ROLE_PROVISION_SQL);
  });
  await assertRuntimeRoleBoundary(sql);
  return true;
}

export async function verifyRuntimeCredential(
  config,
  credentialVerifier = verifyOneShotRuntimeCredential,
) {
  try {
    await credentialVerifier({
      authenticateSql: RUNTIME_ROLE_AUTHENTICATE_SQL,
      authorizeSql: RUNTIME_ROLE_AUTHORIZE_SQL,
      assumeSql: RUNTIME_ROLE_ASSUME_SQL,
      caCertificate: config.getDatabaseCaCertificate(),
      credentialLabel: "durable runtime credential",
      databaseUrl: config.getRuntimeDatabaseUrl(),
    });
  } catch {
    throw new Error(
      "Greenfield TEST durable runtime credential could not authenticate",
    );
  }
}

export async function reapRuntimeCredentialProbe(sql) {
  let row;
  try {
    row = await singleRow(
      sql,
      RUNTIME_CREDENTIAL_PROBE_REAP_SQL,
      "Greenfield TEST credential probe backend did not reconcile",
    );
  } catch {
    throw new Error(
      "Greenfield TEST credential probe backend did not reconcile",
    );
  }
  const candidates = Number(row.candidates);
  const terminated = Number(row.terminated);
  if (
    !Number.isInteger(candidates) ||
    !Number.isInteger(terminated) ||
    candidates < 0 ||
    candidates > 1 ||
    terminated < 0 ||
    terminated > candidates
  ) {
    throw new Error(
      "Greenfield TEST credential probe backend did not reconcile",
    );
  }
  return Object.freeze({ candidates, terminated });
}

export async function verifyRuntimeBoundary(sql, config, credentialVerifier) {
  await assertRuntimeRoleBoundary(sql);
  await verifyRuntimeCredential(config, credentialVerifier);
  await reapRuntimeCredentialProbe(sql);
  await assertRuntimeRoleBoundary(sql);
}

export async function prepareRuntimeCredential(
  sql,
  config,
  credentialVerifier,
  propagationWait = (milliseconds) =>
    new Promise((resolve) => setTimeout(resolve, milliseconds)),
) {
  const provisioned = await provisionRuntimeCredentialOnce(sql, config);
  // The wait is unconditional because a prior operator may have been
  // interrupted immediately after committing the first credential. Without a
  // durable provision timestamp, an existing SCRAM verifier does not prove the
  // Supavisor quiet period already elapsed.
  await propagationWait(RUNTIME_CREDENTIAL_INITIAL_PROPAGATION_DELAY_MS);
  await verifyRuntimeBoundary(sql, config, credentialVerifier);
  return Object.freeze({ provisioned });
}

export const verifyPreviewCredential = verifyRuntimeCredential;

import { createHash, randomBytes } from "node:crypto";

const LOOPBACK_HOSTS = new Set(["127.0.0.1", "localhost", "[::1]"]);
const UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const CODE = /^[A-Z][A-Z0-9_]{1,63}$/;
const CANARY_OPERATIONS = new Set([
  "public_booking",
  "owner_create_appointment",
  "owner_create_block",
  "owner_cancel_schedule_entry",
  "owner_create_vacation",
  "owner_cancel_vacation",
]);

export class LocalCutoverOperatorError extends Error {
  constructor(code) {
    super(code);
    this.name = "LocalCutoverOperatorError";
    this.code = code;
  }
}

function requiredUuid(value, code) {
  if (typeof value !== "string" || !UUID.test(value)) {
    throw new LocalCutoverOperatorError(code);
  }
  return value;
}

function requiredCode(value, errorCode) {
  if (typeof value !== "string" || !CODE.test(value)) {
    throw new LocalCutoverOperatorError(errorCode);
  }
  return value;
}

function oneRow(rows, code) {
  if (!Array.isArray(rows) || rows.length !== 1 || !rows[0]) {
    throw new LocalCutoverOperatorError(code);
  }
  return rows[0];
}

export function assertLocalCutoverOperatorEnvironment(env) {
  if (!new Set(["local", "test"]).has(env.APP_ENV)) {
    throw new LocalCutoverOperatorError("LOCAL_OPERATOR_ENV_REQUIRED");
  }
  const value = env.SUPABASE_DATABASE_URL;
  try {
    const url = new URL(value);
    if (
      !["postgres:", "postgresql:"].includes(url.protocol) ||
      !LOOPBACK_HOSTS.has(url.hostname) ||
      !url.username ||
      !url.pathname.slice(1)
    ) {
      throw new Error();
    }
  } catch {
    throw new LocalCutoverOperatorError("LOCAL_OPERATOR_DATABASE_REQUIRED");
  }
  return true;
}

export function createLocalCutoverOperator({
  database,
  env = process.env,
  now = () => new Date(),
}) {
  assertLocalCutoverOperatorEnvironment(env);
  if (!database || typeof database.unsafe !== "function") {
    throw new LocalCutoverOperatorError("LOCAL_OPERATOR_DATABASE_REQUIRED");
  }
  return Object.freeze({
    async freeze(reasonCode) {
      const row = oneRow(
        await database.unsafe(
          `select freeze_id, version
           from gioia_private.begin_cutover_write_freeze($1::text)`,
          [requiredCode(reasonCode, "INVALID_REASON_CODE")],
        ),
        "UNEXPECTED_FREEZE_RESULT",
      );
      return Object.freeze({ freezeId: row.freeze_id, version: row.version });
    },

    async beginCanaryRun({ freezeId, labelCode, lifetimeSeconds = 900 }) {
      requiredUuid(freezeId, "INVALID_FREEZE_ID");
      requiredCode(labelCode, "INVALID_LABEL_CODE");
      if (
        !Number.isInteger(lifetimeSeconds) ||
        lifetimeSeconds < 1 ||
        lifetimeSeconds > 1800
      ) {
        throw new LocalCutoverOperatorError("INVALID_CANARY_LIFETIME");
      }
      const expiresAt = new Date(now().getTime() + lifetimeSeconds * 1000);
      const row = oneRow(
        await database.unsafe(
          `select gioia_private.begin_cutover_canary_run(
             $1::uuid, $2::text, $3::timestamptz
           ) as run_id`,
          [freezeId, labelCode, expiresAt.toISOString()],
        ),
        "UNEXPECTED_CANARY_RUN_RESULT",
      );
      return Object.freeze({
        runId: row.run_id,
        expiresAt: expiresAt.toISOString(),
      });
    },

    async issueCanaryGrant({
      runId,
      operation,
      idempotencyKey,
      requestFingerprint,
      lifetimeSeconds = 300,
    }) {
      requiredUuid(runId, "INVALID_CANARY_RUN_ID");
      requiredUuid(idempotencyKey, "INVALID_IDEMPOTENCY_KEY");
      if (!CANARY_OPERATIONS.has(operation)) {
        throw new LocalCutoverOperatorError("INVALID_CANARY_OPERATION");
      }
      if (
        !Buffer.isBuffer(requestFingerprint) ||
        requestFingerprint.byteLength !== 32
      ) {
        throw new LocalCutoverOperatorError("INVALID_REQUEST_FINGERPRINT");
      }
      if (
        !Number.isInteger(lifetimeSeconds) ||
        lifetimeSeconds < 1 ||
        lifetimeSeconds > 900
      ) {
        throw new LocalCutoverOperatorError("INVALID_CANARY_LIFETIME");
      }
      const token = randomBytes(32).toString("base64url");
      const tokenHash = createHash("sha256").update(token).digest();
      const expiresAt = new Date(now().getTime() + lifetimeSeconds * 1000);
      const row = oneRow(
        await database.unsafe(
          `select gioia_private.issue_cutover_canary_grant(
             $1::uuid, $2::bytea, $3::text, $4::text, $5::bytea, $6::timestamptz
           ) as grant_id`,
          [
            runId,
            tokenHash,
            operation,
            idempotencyKey,
            Buffer.from(requestFingerprint),
            expiresAt.toISOString(),
          ],
        ),
        "UNEXPECTED_CANARY_GRANT_RESULT",
      );
      return Object.freeze({
        grantId: row.grant_id,
        token,
        expiresAt: expiresAt.toISOString(),
      });
    },

    async revokeCanaryGrant(grantId) {
      requiredUuid(grantId, "INVALID_CANARY_GRANT_ID");
      await database.unsafe(
        "select gioia_private.revoke_cutover_canary_grant($1::uuid)",
        [grantId],
      );
    },

    async reconcileCanaryRun(runId) {
      requiredUuid(runId, "INVALID_CANARY_RUN_ID");
      await database.unsafe(
        "select gioia_private.reconcile_cutover_canary_run($1::uuid)",
        [runId],
      );
    },

    async enterOwnerReconcile({ freezeId, expectedVersion, reasonCode }) {
      requiredUuid(freezeId, "INVALID_FREEZE_ID");
      if (!Number.isInteger(expectedVersion) || expectedVersion < 1) {
        throw new LocalCutoverOperatorError("INVALID_CONTROL_VERSION");
      }
      const row = oneRow(
        await database.unsafe(
          `select gioia_private.enter_cutover_owner_reconcile(
             $1::uuid, $2::integer, $3::text
           ) as version`,
          [
            freezeId,
            expectedVersion,
            requiredCode(reasonCode, "INVALID_REASON_CODE"),
          ],
        ),
        "UNEXPECTED_RECONCILE_RESULT",
      );
      return row.version;
    },

    async unfreeze({ freezeId, expectedVersion, reasonCode }) {
      requiredUuid(freezeId, "INVALID_FREEZE_ID");
      if (!Number.isInteger(expectedVersion) || expectedVersion < 1) {
        throw new LocalCutoverOperatorError("INVALID_CONTROL_VERSION");
      }
      const row = oneRow(
        await database.unsafe(
          `select gioia_private.complete_cutover_unfreeze(
             $1::uuid, $2::integer, $3::text
           ) as version`,
          [
            freezeId,
            expectedVersion,
            requiredCode(reasonCode, "INVALID_REASON_CODE"),
          ],
        ),
        "UNEXPECTED_UNFREEZE_RESULT",
      );
      return row.version;
    },
  });
}

import { createHash, randomBytes } from "node:crypto";

import { TEST_TARGET_REF, TEST_TARGET_REGION } from "./test-target-config.mjs";

const POOLER_HOST = "aws-1-eu-central-2.pooler.supabase.com";
const OPERATOR_USERNAME = `postgres.${TEST_TARGET_REF}`;
const UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const CODE = /^[A-Z][A-Z0-9_]{1,63}$/;
export const MAX_CANARY_GRANTS_PER_RUN = 6;
export const CANARY_OPERATIONS = new Set([
  "public_booking",
  "owner_create_appointment",
  "owner_create_block",
  "owner_cancel_schedule_entry",
  "owner_create_vacation",
  "owner_cancel_vacation",
]);

export class TestTargetMaintenanceOperatorError extends Error {
  constructor(code) {
    super(code);
    this.name = "TestTargetMaintenanceOperatorError";
    this.code = code;
  }
}

export function requiredUuid(value, code) {
  if (typeof value !== "string" || !UUID.test(value)) {
    throw new TestTargetMaintenanceOperatorError(code);
  }
  return value;
}

export function requiredCode(value, code) {
  if (typeof value !== "string" || !CODE.test(value)) {
    throw new TestTargetMaintenanceOperatorError(code);
  }
  return value;
}

export function requiredVersion(value) {
  if (!Number.isInteger(value) || value < 1) {
    throw new TestTargetMaintenanceOperatorError("INVALID_CONTROL_VERSION");
  }
  return value;
}

export function oneRow(rows, code) {
  if (!Array.isArray(rows) || rows.length !== 1 || !rows[0]) {
    throw new TestTargetMaintenanceOperatorError(code);
  }
  return rows[0];
}

function exactDatabaseUrl(value, port) {
  try {
    const url = new URL(value);
    const validQuery =
      url.searchParams.size === 1 &&
      url.searchParams.get("sslmode") === "verify-full";
    if (
      url.protocol !== "postgresql:" ||
      decodeURIComponent(url.username) !== OPERATOR_USERNAME ||
      !url.password ||
      url.hostname !== POOLER_HOST ||
      url.port !== String(port) ||
      url.pathname !== "/postgres" ||
      url.hash ||
      !validQuery
    ) {
      throw new Error();
    }
    return url;
  } catch {
    throw new TestTargetMaintenanceOperatorError(
      "REMOTE_TEST_OPERATOR_DATABASE_REQUIRED",
    );
  }
}

export function assertRemoteTestMaintenanceConfig(config) {
  if (
    !config ||
    config.appEnv !== "operator" ||
    config.environment !== "test" ||
    config.projectRef !== TEST_TARGET_REF ||
    config.poolerHost !== POOLER_HOST ||
    config.poolerRegion !== TEST_TARGET_REGION ||
    config.operatorSessionPort !== 5432 ||
    config.operatorWorkerPort !== 6543 ||
    config.sslmode !== "verify-full" ||
    typeof config.getOperatorSessionDatabaseUrl !== "function" ||
    typeof config.getOperatorWorkerDatabaseUrl !== "function" ||
    typeof config.getDatabaseCaCertificate !== "function"
  ) {
    throw new TestTargetMaintenanceOperatorError(
      "REMOTE_TEST_OPERATOR_CONFIG_REQUIRED",
    );
  }
  const session = exactDatabaseUrl(
    config.getOperatorSessionDatabaseUrl(),
    5432,
  );
  const worker = exactDatabaseUrl(config.getOperatorWorkerDatabaseUrl(), 6543);
  if (
    decodeURIComponent(session.password) !== decodeURIComponent(worker.password)
  ) {
    throw new TestTargetMaintenanceOperatorError(
      "REMOTE_TEST_OPERATOR_DATABASE_REQUIRED",
    );
  }
  const certificate = config.getDatabaseCaCertificate();
  if (typeof certificate !== "string" || certificate.length === 0) {
    throw new TestTargetMaintenanceOperatorError(
      "REMOTE_TEST_OPERATOR_CA_REQUIRED",
    );
  }
  return Object.freeze({
    certificate,
    sessionDatabaseUrl: session.href,
    workerDatabaseUrl: worker.href,
  });
}

export function exactGrantIds(value) {
  if (
    !Array.isArray(value) ||
    value.length > MAX_CANARY_GRANTS_PER_RUN ||
    new Set(value).size !== value.length
  ) {
    throw new TestTargetMaintenanceOperatorError("INVALID_CANARY_GRANT_IDS");
  }
  return Object.freeze(
    value.map((id) => requiredUuid(id, "INVALID_CANARY_GRANT_ID")).sort(),
  );
}

export function createCanaryToken(tokenBytes = () => randomBytes(32)) {
  const rawToken = tokenBytes();
  if (!Buffer.isBuffer(rawToken) || rawToken.byteLength !== 32) {
    throw new TestTargetMaintenanceOperatorError("INVALID_CANARY_TOKEN");
  }
  const token = Buffer.from(rawToken).toString("base64url");
  return Object.freeze({
    token,
    tokenHash: createHash("sha256").update(token).digest(),
  });
}

export function expiresAt(now, lifetimeSeconds, maximum) {
  if (
    !Number.isInteger(lifetimeSeconds) ||
    lifetimeSeconds < 1 ||
    lifetimeSeconds > maximum
  ) {
    throw new TestTargetMaintenanceOperatorError("INVALID_CANARY_LIFETIME");
  }
  const value = new Date(now().getTime() + lifetimeSeconds * 1000);
  if (Number.isNaN(value.getTime())) {
    throw new TestTargetMaintenanceOperatorError("INVALID_OPERATOR_CLOCK");
  }
  return value.toISOString();
}

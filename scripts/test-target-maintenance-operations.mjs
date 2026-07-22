import {
  CANARY_OPERATIONS,
  TestTargetMaintenanceOperatorError,
  assertRemoteTestMaintenanceConfig,
  createCanaryToken,
  expiresAt,
  oneRow,
  requiredCode,
  requiredUuid,
  requiredVersion,
} from "./test-target-maintenance-contract.mjs";
import { cleanupRemoteTestCanaryRun } from "./test-target-maintenance-cleanup.mjs";

async function boundedTransaction(database, callback) {
  return database.begin(async (transaction) => {
    await transaction.unsafe("set local lock_timeout = '5s'");
    await transaction.unsafe("set local statement_timeout = '30s'");
    await transaction.unsafe(
      "set local idle_in_transaction_session_timeout = '30s'",
    );
    return callback(transaction);
  });
}

export function createRemoteTestMaintenanceOperator({
  database,
  config,
  now = () => new Date(),
  tokenBytes,
}) {
  assertRemoteTestMaintenanceConfig(config);
  if (
    !database ||
    typeof database.unsafe !== "function" ||
    typeof database.begin !== "function"
  ) {
    throw new TestTargetMaintenanceOperatorError(
      "REMOTE_TEST_OPERATOR_DATABASE_REQUIRED",
    );
  }

  async function readState() {
    return boundedTransaction(database, async (transaction) => {
      const row = oneRow(
        await transaction.unsafe(
          `select control.mode, control.freeze_id, control.version,
             (select count(*)::integer
              from gioia_private.cutover_canary_runs
              where status = 'active') as active_runs,
             (select count(*)::integer
              from gioia_private.cutover_canary_grants
              where status = 'issued') as issued_grants
           from gioia_private.cutover_write_control as control
           where control.singleton`,
        ),
        "UNEXPECTED_CONTROL_STATE",
      );
      if (
        !["open", "frozen", "owner_reconcile"].includes(row.mode) ||
        !Number.isInteger(row.version) ||
        row.version < 1 ||
        !Number.isInteger(row.active_runs) ||
        row.active_runs < 0 ||
        !Number.isInteger(row.issued_grants) ||
        row.issued_grants < 0 ||
        (row.freeze_id !== null &&
          !requiredUuid(row.freeze_id, "UNEXPECTED_CONTROL_STATE"))
      ) {
        throw new TestTargetMaintenanceOperatorError(
          "UNEXPECTED_CONTROL_STATE",
        );
      }
      return Object.freeze({
        mode: row.mode,
        freezeId: row.freeze_id,
        version: row.version,
        activeRuns: row.active_runs,
        issuedGrants: row.issued_grants,
      });
    });
  }

  async function assertOpen() {
    const state = await readState();
    if (
      state.mode !== "open" ||
      state.freezeId !== null ||
      state.activeRuns !== 0 ||
      state.issuedGrants !== 0
    ) {
      throw new TestTargetMaintenanceOperatorError(
        "REMOTE_TEST_MAINTENANCE_NOT_CLEAN",
      );
    }
    return state;
  }

  return Object.freeze({
    readState,
    assertOpen,
    async freeze(reasonCode) {
      return boundedTransaction(database, async (transaction) => {
        const row = oneRow(
          await transaction.unsafe(
            `select freeze_id, version
             from gioia_private.begin_cutover_write_freeze($1::text)`,
            [requiredCode(reasonCode, "INVALID_REASON_CODE")],
          ),
          "UNEXPECTED_FREEZE_RESULT",
        );
        return Object.freeze({
          freezeId: requiredUuid(row.freeze_id, "UNEXPECTED_FREEZE_RESULT"),
          version: requiredVersion(row.version),
        });
      });
    },
    async beginCanaryRun({ freezeId, labelCode, lifetimeSeconds = 900 }) {
      requiredUuid(freezeId, "INVALID_FREEZE_ID");
      requiredCode(labelCode, "INVALID_LABEL_CODE");
      const expiration = expiresAt(now, lifetimeSeconds, 1800);
      return boundedTransaction(database, async (transaction) => {
        const row = oneRow(
          await transaction.unsafe(
            `select gioia_private.begin_cutover_canary_run(
               $1::uuid, $2::text, $3::timestamptz
             ) as run_id`,
            [freezeId, labelCode, expiration],
          ),
          "UNEXPECTED_CANARY_RUN_RESULT",
        );
        return Object.freeze({
          runId: requiredUuid(row.run_id, "UNEXPECTED_CANARY_RUN_RESULT"),
          expiresAt: expiration,
        });
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
        throw new TestTargetMaintenanceOperatorError(
          "INVALID_CANARY_OPERATION",
        );
      }
      if (
        !Buffer.isBuffer(requestFingerprint) ||
        requestFingerprint.byteLength !== 32
      ) {
        throw new TestTargetMaintenanceOperatorError(
          "INVALID_REQUEST_FINGERPRINT",
        );
      }
      const expiration = expiresAt(now, lifetimeSeconds, 900);
      const { token, tokenHash } = createCanaryToken(tokenBytes);
      return boundedTransaction(database, async (transaction) => {
        const row = oneRow(
          await transaction.unsafe(
            `select gioia_private.issue_cutover_canary_grant(
               $1::uuid, $2::bytea, $3::text, $4::text, $5::bytea,
               $6::timestamptz
             ) as grant_id`,
            [
              runId,
              tokenHash,
              operation,
              idempotencyKey,
              Buffer.from(requestFingerprint),
              expiration,
            ],
          ),
          "UNEXPECTED_CANARY_GRANT_RESULT",
        );
        return Object.freeze({
          grantId: requiredUuid(row.grant_id, "UNEXPECTED_CANARY_GRANT_RESULT"),
          token,
          expiresAt: expiration,
        });
      });
    },
    async revokeCanaryGrant(grantId) {
      requiredUuid(grantId, "INVALID_CANARY_GRANT_ID");
      await boundedTransaction(database, (transaction) =>
        transaction.unsafe(
          "select gioia_private.revoke_cutover_canary_grant($1::uuid)",
          [grantId],
        ),
      );
    },
    async reconcileCanaryRun(runId) {
      requiredUuid(runId, "INVALID_CANARY_RUN_ID");
      await boundedTransaction(database, (transaction) =>
        transaction.unsafe(
          "select gioia_private.reconcile_cutover_canary_run($1::uuid)",
          [runId],
        ),
      );
    },
    async cleanupCanaryRun(input) {
      return boundedTransaction(database, (transaction) =>
        cleanupRemoteTestCanaryRun(transaction, input),
      );
    },
    async enterOwnerReconcile({ freezeId, expectedVersion, reasonCode }) {
      requiredUuid(freezeId, "INVALID_FREEZE_ID");
      requiredVersion(expectedVersion);
      return boundedTransaction(database, async (transaction) => {
        const row = oneRow(
          await transaction.unsafe(
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
        return requiredVersion(row.version);
      });
    },
    async unfreeze({ freezeId, expectedVersion, reasonCode }) {
      requiredUuid(freezeId, "INVALID_FREEZE_ID");
      requiredVersion(expectedVersion);
      return boundedTransaction(database, async (transaction) => {
        const row = oneRow(
          await transaction.unsafe(
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
        return requiredVersion(row.version);
      });
    },
  });
}

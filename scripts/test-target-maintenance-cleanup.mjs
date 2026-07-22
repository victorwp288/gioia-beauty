import {
  MAX_CANARY_GRANTS_PER_RUN,
  TestTargetMaintenanceOperatorError,
  exactGrantIds,
  requiredUuid,
} from "./test-target-maintenance-contract.mjs";

export async function cleanupRemoteTestCanaryRun(
  transaction,
  { freezeId, runId, grantIds },
) {
  requiredUuid(freezeId, "INVALID_FREEZE_ID");
  requiredUuid(runId, "INVALID_CANARY_RUN_ID");
  const expectedGrantIds = exactGrantIds(grantIds);
  const rows = await transaction.unsafe(
    `select run.freeze_id, run.status as run_status,
       grant_row.id as grant_id, grant_row.status as grant_status
     from gioia_private.cutover_canary_runs as run
     left join gioia_private.cutover_canary_grants as grant_row
       on grant_row.run_id = run.id
     where run.id = $1::uuid
     order by grant_row.id
     limit $2::integer`,
    [runId, MAX_CANARY_GRANTS_PER_RUN + 2],
  );
  if (!Array.isArray(rows) || rows.length < 1) {
    throw new TestTargetMaintenanceOperatorError(
      "CANARY_CLEANUP_TARGET_MISMATCH",
    );
  }
  const runFreezeIds = new Set(rows.map((row) => row.freeze_id));
  const runStatuses = new Set(rows.map((row) => row.run_status));
  const actualGrantIds = rows
    .map((row) => row.grant_id)
    .filter((id) => id !== null)
    .sort();
  if (
    rows.length > MAX_CANARY_GRANTS_PER_RUN + 1 ||
    runFreezeIds.size !== 1 ||
    !runFreezeIds.has(freezeId) ||
    runStatuses.size !== 1 ||
    actualGrantIds.some(
      (id) =>
        typeof id !== "string" || !requiredUuid(id, "INVALID_CANARY_GRANT_ID"),
    ) ||
    actualGrantIds.length !== expectedGrantIds.length ||
    actualGrantIds.some((id, index) => id !== expectedGrantIds[index])
  ) {
    throw new TestTargetMaintenanceOperatorError(
      "CANARY_CLEANUP_TARGET_MISMATCH",
    );
  }

  const status = rows[0].run_status;
  const revokedGrantIds = [];
  for (const row of rows) {
    if (row.grant_id === null) continue;
    if (!["issued", "used", "revoked"].includes(row.grant_status)) {
      throw new TestTargetMaintenanceOperatorError(
        "CANARY_CLEANUP_TARGET_MISMATCH",
      );
    }
    if (row.grant_status === "issued") {
      await transaction.unsafe(
        "select gioia_private.revoke_cutover_canary_grant($1::uuid)",
        [row.grant_id],
      );
      revokedGrantIds.push(row.grant_id);
    }
  }
  if (status === "active") {
    await transaction.unsafe(
      "select gioia_private.reconcile_cutover_canary_run($1::uuid)",
      [runId],
    );
  } else if (status !== "reconciled" || revokedGrantIds.length > 0) {
    throw new TestTargetMaintenanceOperatorError(
      "CANARY_CLEANUP_TARGET_MISMATCH",
    );
  }
  return Object.freeze({
    runId,
    reconciled: true,
    alreadyReconciled: status === "reconciled",
    revokedGrantIds: Object.freeze(revokedGrantIds),
  });
}

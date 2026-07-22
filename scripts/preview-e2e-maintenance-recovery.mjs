import {
  PREVIEW_MAINTENANCE,
  PREVIEW_MAINTENANCE_COMMANDS,
} from "./preview-e2e-maintenance-fixture.mjs";

function ownsCommand(row) {
  return PREVIEW_MAINTENANCE_COMMANDS.some(
    ([key, operation]) =>
      row.idempotency_key === key && row.operation === operation,
  );
}

function exactlyOne(rows, message) {
  if (!Array.isArray(rows) || rows.length !== 1) throw new Error(message);
  return rows[0];
}

export async function adoptPreviewFreeze(sql) {
  const row = exactlyOne(
    await sql.unsafe(
      `select control.freeze_id, control.version
       from gioia_private.cutover_write_control as control
       join gioia_private.cutover_transition_log as transition
         on transition.freeze_id = control.freeze_id
         and transition.control_version = control.version
       where control.singleton and control.mode = 'frozen'
         and transition.from_mode = 'open' and transition.to_mode = 'frozen'
         and transition.reason_code = 'PHASE4_PREVIEW_BROWSER'
       limit 2`,
    ),
    "Preview freeze could not be adopted",
  );
  return Object.freeze({
    freezeId: row.freeze_id,
    version: Number(row.version),
  });
}

export async function adoptPreviewCanaryRun(sql, freezeId) {
  const row = exactlyOne(
    await sql.unsafe(
      `select id from gioia_private.cutover_canary_runs
       where freeze_id = $1::uuid and label_code = 'PHASE4_PREVIEW_CANARY'
       order by created_at, id limit 2`,
      [freezeId],
    ),
    "Preview canary run could not be adopted",
  );
  return Object.freeze({ runId: row.id });
}

export async function adoptPreviewCanaryGrant(sql, input) {
  const row = exactlyOne(
    await sql.unsafe(
      `select id from gioia_private.cutover_canary_grants
       where run_id = $1::uuid and operation = $2::text
         and idempotency_key = $3::text and request_fingerprint = $4::bytea
       limit 2`,
      [
        input.runId,
        input.operation,
        input.idempotencyKey,
        input.requestFingerprint,
      ],
    ),
    "Preview canary grant could not be adopted",
  );
  return Object.freeze({ grantId: row.id });
}

export async function recoverPreviewMaintenanceResources(sql, scenario) {
  await sql.begin(async (transaction) => {
    await transaction.unsafe("set transaction isolation level serializable");
    await transaction.unsafe("set local lock_timeout = '5s'");
    await transaction.unsafe("set local statement_timeout = '30s'");
    const commands = await transaction.unsafe(
      `select id, operation, idempotency_key, state, resource_id
       from gioia_private.command_requests
       where idempotency_key = any($1::text[]) for update`,
      [PREVIEW_MAINTENANCE_COMMANDS.map(([key]) => key)],
    );
    if (
      commands.length > PREVIEW_MAINTENANCE_COMMANDS.length ||
      commands.some((row) => !ownsCommand(row))
    ) {
      throw new Error("Preview maintenance commands are not owned");
    }
    const resourceIds = commands
      .map((row) => row.resource_id)
      .filter((id) => typeof id === "string");
    if (resourceIds.length === 0) return;
    const entries = await transaction.unsafe(
      `select id, status, version from gioia_private.schedule_entries
       where id = any($1::uuid[]) and source = 'admin'
         and local_date = $2::date and start_minutes = 600
         and service_id = $3::text and variant_id = $4::text
         and client_email is null and client_phone is null
         and client_note is null and created_by = $6::uuid
         and client_name = any($5::text[]) for update`,
      [
        resourceIds,
        scenario.target.localDate,
        scenario.target.serviceId,
        scenario.target.variantId,
        [PREVIEW_MAINTENANCE.canaryName, PREVIEW_MAINTENANCE.manualName],
        scenario.ownerId,
      ],
    );
    if (entries.length !== new Set(resourceIds).size) {
      throw new Error("Preview maintenance resources are not owned");
    }
    for (const entry of entries) {
      if (entry.status === "cancelled" && Number(entry.version) === 2) continue;
      if (entry.status !== "confirmed" || Number(entry.version) !== 1) {
        throw new Error("Preview maintenance resource state is unsafe");
      }
      const updated = await transaction.unsafe(
        `update gioia_private.schedule_entries
         set status = 'cancelled', cancelled_at = statement_timestamp(),
           cancelled_by = 'system',
           cancellation_reason = 'synthetic TEST recovery'
         where id = $1::uuid and status = 'confirmed' and version = 1
         returning id, version`,
        [entry.id],
      );
      if (updated.length !== 1 || Number(updated[0].version) !== 2) {
        throw new Error("Preview maintenance recovery changed concurrently");
      }
    }
  });
}

export async function abortPreviewCanaryRun(sql, scenario) {
  await sql.begin(async (transaction) => {
    await transaction.unsafe("set transaction isolation level serializable");
    await transaction.unsafe("set local lock_timeout = '5s'");
    await transaction.unsafe("set local statement_timeout = '30s'");
    const control = await transaction.unsafe(
      `select mode, freeze_id from gioia_private.cutover_write_control
       where singleton for update`,
    );
    if (
      control.length !== 1 ||
      !["frozen", "owner_reconcile"].includes(control[0].mode) ||
      control[0].freeze_id !== scenario.freezeId
    ) {
      throw new Error("Preview canary abort does not own maintenance");
    }
    const runs = await transaction.unsafe(
      `select id, freeze_id, label_code, status
       from gioia_private.cutover_canary_runs
       where id = $1::uuid for update`,
      [scenario.runId],
    );
    const grants = await transaction.unsafe(
      `select id, run_id, operation, idempotency_key, request_fingerprint,
         status
       from gioia_private.cutover_canary_grants
       where run_id = $1::uuid order by id for update`,
      [scenario.runId],
    );
    const expectedGrantIds = [...scenario.grantIds].sort();
    if (
      runs.length !== 1 ||
      runs[0].freeze_id !== scenario.freezeId ||
      runs[0].label_code !== "PHASE4_PREVIEW_CANARY" ||
      !["active", "reconciled"].includes(runs[0].status) ||
      grants.length !== expectedGrantIds.length ||
      grants
        .map((row) => row.id)
        .sort()
        .join("|") !== expectedGrantIds.join("|") ||
      grants.some(
        (row) =>
          row.run_id !== scenario.runId ||
          !["issued", "used", "revoked"].includes(row.status) ||
          !PREVIEW_MAINTENANCE_COMMANDS.slice(0, 2).some(
            ([key, operation]) =>
              row.idempotency_key === key && row.operation === operation,
          ),
      )
    ) {
      throw new Error("Preview canary abort target is not exact");
    }
    const invalidUsed = await transaction.unsafe(
      `select grant_row.id from gioia_private.cutover_canary_grants as grant_row
       left join gioia_private.command_requests as command
         on command.operation = grant_row.operation
         and command.idempotency_key = grant_row.idempotency_key
         and command.request_fingerprint = grant_row.request_fingerprint
       where grant_row.run_id = $1::uuid and grant_row.status = 'used'
       group by grant_row.id having count(command.id) <> 1`,
      [scenario.runId],
    );
    const events = await transaction.unsafe(
      `select grant_id, freeze_id, operation, event_kind
       from gioia_private.cutover_canary_events where run_id = $1::uuid`,
      [scenario.runId],
    );
    if (
      invalidUsed.length !== 0 ||
      events.length > grants.filter((row) => row.status === "used").length ||
      events.some(
        (event) =>
          event.freeze_id !== scenario.freezeId ||
          event.event_kind !== "authorized" ||
          !grants.some(
            (grant) =>
              grant.id === event.grant_id &&
              grant.operation === event.operation,
          ),
      )
    ) {
      throw new Error("Preview canary abort evidence is not exact");
    }
    await transaction.unsafe(
      `delete from gioia_private.cutover_canary_events
       where run_id = $1::uuid`,
      [scenario.runId],
    );
    const removedGrants = await transaction.unsafe(
      `delete from gioia_private.cutover_canary_grants
       where run_id = $1::uuid returning id`,
      [scenario.runId],
    );
    const removedRuns = await transaction.unsafe(
      `delete from gioia_private.cutover_canary_runs
       where id = $1::uuid and freeze_id = $2::uuid returning id`,
      [scenario.runId, scenario.freezeId],
    );
    if (removedGrants.length !== grants.length || removedRuns.length !== 1) {
      throw new Error("Preview canary abort changed concurrently");
    }
  });
}

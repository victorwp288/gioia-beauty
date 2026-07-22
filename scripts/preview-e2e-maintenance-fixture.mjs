export const PREVIEW_MAINTENANCE = Object.freeze({
  blockedOwnerKey: "73000000-0000-4000-8000-000000000101",
  blockedPublicKey: "73000000-0000-4000-8000-000000000102",
  canaryCreateKey: "73000000-0000-4000-8000-000000000103",
  canaryCancelKey: "73000000-0000-4000-8000-000000000104",
  manualCreateKey: "73000000-0000-4000-8000-000000000105",
  manualCancelKey: "73000000-0000-4000-8000-000000000106",
  canaryName: "Preview synthetic canary appointment",
  manualName: "MAN-PREVIEW synthetic reconciliation",
});

export const PREVIEW_MAINTENANCE_COMMANDS = Object.freeze([
  [PREVIEW_MAINTENANCE.canaryCreateKey, "owner_create_appointment"],
  [PREVIEW_MAINTENANCE.canaryCancelKey, "owner_cancel_schedule_entry"],
  [PREVIEW_MAINTENANCE.manualCreateKey, "owner_create_appointment"],
  [PREVIEW_MAINTENANCE.manualCancelKey, "owner_cancel_schedule_entry"],
]);

function integer(row, key) {
  const value = Number(row?.[key]);
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new Error("Preview maintenance evidence returned invalid counts");
  }
  return value;
}

export function assertPreviewMaintenanceEvidence(row) {
  const exact =
    row?.run_exact === true &&
    row?.ledger_exact === true &&
    integer(row, "runs") === 1 &&
    integer(row, "grants") === 2 &&
    integer(row, "used_grants") === 2 &&
    integer(row, "events") === 2 &&
    integer(row, "commands") === 4 &&
    integer(row, "completed_commands") === 4 &&
    integer(row, "blocked_commands") === 0 &&
    integer(row, "entries") === 2 &&
    integer(row, "exact_entries") === 2 &&
    integer(row, "active_entries") === 0 &&
    integer(row, "changes") === 4 &&
    integer(row, "outbox_rows") === 0;
  if (!exact) throw new Error("Preview maintenance evidence is not exact");
}

export async function verifyPreviewMaintenanceEvidence(sql, scenario) {
  const keys = PREVIEW_MAINTENANCE_COMMANDS.map(([key]) => key);
  const [row, ...extra] = await sql.unsafe(
    `with expected(operation, idempotency_key, change_kind, aggregate_version) as (
       select * from unnest(
         $11::text[], $12::text[], $13::text[], $14::integer[]
       )
     ), owned_commands as (
       select * from gioia_private.command_requests
       where idempotency_key = any($4::text[])
     ), owned_entries as (
       select distinct entry.* from gioia_private.schedule_entries as entry
       join owned_commands as command on command.resource_id = entry.id
     )
     select
       (select count(*)::integer from gioia_private.cutover_canary_runs
         where id = $1::uuid) as runs,
       exists(select 1 from gioia_private.cutover_canary_runs
         where id = $1::uuid and freeze_id = $2::uuid
           and label_code = 'PHASE4_PREVIEW_CANARY' and status = 'reconciled')
         as run_exact,
       not exists (
         select 1 from expected
         left join owned_commands as command
           on command.operation = expected.operation
           and command.idempotency_key = expected.idempotency_key
         where command.id is null or command.state <> 'completed'
           or command.resource_kind <> 'schedule_entry'
           or command.resource_id is null
       ) and not exists (
         select 1 from owned_commands as command
         left join expected on expected.operation = command.operation
           and expected.idempotency_key = command.idempotency_key
         where expected.operation is null
       ) and not exists (
         select 1 from gioia_private.cutover_canary_grants as grant_row
         left join owned_commands as command
           on command.operation = grant_row.operation
           and command.idempotency_key = grant_row.idempotency_key
           and command.request_fingerprint = grant_row.request_fingerprint
         where grant_row.run_id = $1::uuid and command.id is null
       ) and (
         select count(*) from owned_entries
         where client_name = $15::text
       ) = 1 and (
         select count(*) from owned_entries
         where client_name = $16::text
       ) = 1 and not exists (
         select 1 from gioia_private.domain_change_log as change
         join owned_commands as command on command.id = change.command_request_id
         join expected on expected.operation = command.operation
           and expected.idempotency_key = command.idempotency_key
         where change.aggregate_kind <> 'schedule_entry'
           or change.aggregate_id <> command.resource_id
           or change.change_kind <> expected.change_kind
           or change.aggregate_version <> expected.aggregate_version
           or change.source <> 'admin' or change.actor_user_id <> $10::uuid
       ) as ledger_exact,
       (select count(*)::integer from gioia_private.cutover_canary_grants
         where run_id = $1::uuid) as grants,
       (select count(*)::integer from gioia_private.cutover_canary_grants
         where run_id = $1::uuid and id = any($3::uuid[])
           and status = 'used') as used_grants,
       (select count(*)::integer from gioia_private.cutover_canary_events
         where run_id = $1::uuid and grant_id = any($3::uuid[])
           and freeze_id = $2::uuid and event_kind = 'authorized') as events,
       (select count(*)::integer from owned_commands) as commands,
       (select count(*)::integer from owned_commands
         where state = 'completed' and resource_kind = 'schedule_entry'
           and resource_id is not null) as completed_commands,
       (select count(*)::integer from gioia_private.command_requests
         where idempotency_key = any($5::text[])) as blocked_commands,
       (select count(*)::integer from owned_entries) as entries,
       (select count(*)::integer from owned_entries
         where kind = 'appointment' and status = 'cancelled'
           and source = 'admin' and local_date = $6::date
           and start_minutes = 600 and service_id = $7::text
           and variant_id = $8::text and client_email is null
           and client_phone is null and client_note is null
           and created_by = $10::uuid and version = 2
           and client_name = any($9::text[])) as exact_entries,
       (select count(*)::integer from owned_entries
         where status <> 'cancelled') as active_entries,
       (select count(*)::integer from gioia_private.domain_change_log as change
         join owned_commands as command on command.id = change.command_request_id
         where change.aggregate_kind = 'schedule_entry'
           and change.aggregate_id = command.resource_id
           and change.source = 'admin') as changes,
       (select count(*)::integer from gioia_private.email_outbox as outbox
         join owned_entries as entry on entry.id = outbox.aggregate_id)
         as outbox_rows`,
    [
      scenario.runId,
      scenario.freezeId,
      scenario.grantIds,
      keys,
      [
        PREVIEW_MAINTENANCE.blockedOwnerKey,
        PREVIEW_MAINTENANCE.blockedPublicKey,
      ],
      scenario.target.localDate,
      scenario.target.serviceId,
      scenario.target.variantId,
      [PREVIEW_MAINTENANCE.canaryName, PREVIEW_MAINTENANCE.manualName],
      scenario.ownerId,
      PREVIEW_MAINTENANCE_COMMANDS.map(([, operation]) => operation),
      PREVIEW_MAINTENANCE_COMMANDS.map(([key]) => key),
      ["create", "cancel", "create", "cancel"],
      [1, 2, 1, 2],
      PREVIEW_MAINTENANCE.canaryName,
      PREVIEW_MAINTENANCE.manualName,
    ],
  );
  if (!row || extra.length !== 0) {
    throw new Error("Preview maintenance evidence returned invalid rows");
  }
  assertPreviewMaintenanceEvidence(row);
}

export async function cleanupPreviewMaintenanceScenario(sql, scenario) {
  await sql.begin(async (transaction) => {
    await transaction.unsafe("set transaction isolation level serializable");
    await transaction.unsafe("set local lock_timeout = '5s'");
    await transaction.unsafe("set local statement_timeout = '30s'");
    const state = await transaction.unsafe(
      `select mode, freeze_id from gioia_private.cutover_write_control
       where singleton for update`,
    );
    if (state.length !== 1 || state[0].mode !== "open" || state[0].freeze_id) {
      throw new Error("Preview maintenance cleanup requires open state");
    }
    const commands = await transaction.unsafe(
      `select id, operation, idempotency_key, resource_id
       from gioia_private.command_requests
       where idempotency_key = any($1::text[]) for update`,
      [PREVIEW_MAINTENANCE_COMMANDS.map(([key]) => key)],
    );
    if (
      commands.length > PREVIEW_MAINTENANCE_COMMANDS.length ||
      commands.some(
        (row) =>
          !PREVIEW_MAINTENANCE_COMMANDS.some(
            ([key, operation]) =>
              row.idempotency_key === key && row.operation === operation,
          ),
      )
    ) {
      throw new Error("Preview maintenance cleanup target is not exact");
    }
    const resourceIds = [
      ...new Set(
        commands
          .map((row) => row.resource_id)
          .filter((id) => typeof id === "string"),
      ),
    ];
    const outbox = resourceIds.length
      ? await transaction.unsafe(
          `select id from gioia_private.email_outbox
           where aggregate_id = any($1::uuid[]) limit 2`,
          [resourceIds],
        )
      : [];
    if (outbox.length !== 0) {
      throw new Error("Preview maintenance unexpectedly created email");
    }
    await transaction.unsafe(
      `delete from gioia_private.domain_change_log
       where command_request_id = any($1::uuid[])`,
      [commands.map((row) => row.id)],
    );
    await transaction.unsafe(
      `delete from gioia_private.command_requests
       where id = any($1::uuid[])`,
      [commands.map((row) => row.id)],
    );
    if (resourceIds.length > 0) {
      const removed = await transaction.unsafe(
        `delete from gioia_private.schedule_entries
         where id = any($1::uuid[]) and status = 'cancelled'
           and source = 'admin' and local_date = $2::date
           and start_minutes = 600 and service_id = $3::text
           and variant_id = $4::text and client_email is null
           and client_phone is null and client_note is null
           and created_by = $5::uuid and version = 2
           and client_name = any($6::text[]) returning id`,
        [
          resourceIds,
          scenario.target.localDate,
          scenario.target.serviceId,
          scenario.target.variantId,
          scenario.ownerId,
          [PREVIEW_MAINTENANCE.canaryName, PREVIEW_MAINTENANCE.manualName],
        ],
      );
      if (removed.length !== resourceIds.length) {
        throw new Error("Preview maintenance entry cleanup was not exact");
      }
    }
    if (scenario.runId) {
      await transaction.unsafe(
        `delete from gioia_private.cutover_canary_events
         where run_id = $1::uuid and grant_id = any($2::uuid[])`,
        [scenario.runId, scenario.grantIds],
      );
      const grants = await transaction.unsafe(
        `delete from gioia_private.cutover_canary_grants
         where run_id = $1::uuid and id = any($2::uuid[]) returning id`,
        [scenario.runId, scenario.grantIds],
      );
      const runs = await transaction.unsafe(
        `delete from gioia_private.cutover_canary_runs
         where id = $1::uuid and freeze_id = $2::uuid
           and status = 'reconciled' returning id`,
        [scenario.runId, scenario.freezeId],
      );
      if (grants.length !== scenario.grantIds.length || runs.length !== 1) {
        throw new Error("Preview canary cleanup was not exact");
      }
    }
    await transaction.unsafe(
      `delete from gioia_private.schedule_day_locks
       where local_date = $1::date and not exists (
         select 1 from gioia_private.schedule_entries where local_date = $1::date
       ) and not exists (
         select 1 from gioia_private.vacations where status = 'active'
           and daterange(start_date, end_date, '[]') @> $1::date
       )`,
      [scenario.target.localDate],
    );
  });
}

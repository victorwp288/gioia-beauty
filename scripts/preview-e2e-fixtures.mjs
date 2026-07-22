export const PREVIEW_BOOKING_IDEMPOTENCY_KEY =
  "73000000-0000-4000-8000-000000000001";
export const PREVIEW_BOOKING_PERSON = Object.freeze({
  name: "Cliente Preview Sintetica",
  email: "cliente.preview@example.test",
  phone: "+390000000000",
  note: "phase4-preview-browser-booking",
});

const CLEANUP_STATE_SQL = `
  with command as (
    select id, state, resource_id, resource_kind
    from gioia_private.command_requests
    where operation = 'public_booking' and idempotency_key = $1::text
  ), entry as (
    select schedule.* from gioia_private.schedule_entries schedule
    join command on command.resource_id = schedule.id
  )
  select
    (select count(*)::integer from command) as commands,
    (select count(*)::integer from command where state = 'completed'
      and resource_kind = 'schedule_entry' and resource_id is not null)
      as completed_commands,
    (select count(*)::integer from command where state = 'failed'
      and resource_kind is null and resource_id is null) as failed_commands,
    (select count(*)::integer from entry) as entries,
    (select count(*)::integer from entry
      where kind = 'appointment' and status = 'confirmed' and source = 'public'
        and local_date = $2::date and start_minutes = 600
        and service_id = $3::text and variant_id = $4::text
        and client_name = $5::text and client_email = $6::text
        and client_phone = $7::text and client_note = $8::text
        and created_by is null and version = 1 and cancelled_at is null
        and legacy_firestore_id is null and imported_at is null) as exact_entries,
    (select count(*)::integer from gioia_private.domain_change_log change
      join command on command.id = change.command_request_id
      where change.aggregate_id = command.resource_id
        and change.aggregate_kind = 'schedule_entry'
        and change.aggregate_version = 1 and change.change_kind = 'create'
        and change.source = 'public' and change.actor_user_id is null)
      as changes,
    (select count(*)::integer from gioia_private.email_outbox outbox
      join command on command.resource_id = outbox.aggregate_id
      where outbox.aggregate_kind = 'schedule_entry'
        and outbox.aggregate_version = 1 and outbox.status = 'pending'
        and outbox.attempt_count = 0) as outbox_rows
`;

function nonnegativeInteger(row, field) {
  const value = Number(row?.[field]);
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new Error("Preview browser cleanup returned invalid counts");
  }
  return value;
}

export function assertPreviewBookingCleanupState(row) {
  const commands = nonnegativeInteger(row, "commands");
  const completed = nonnegativeInteger(row, "completed_commands");
  const failed = nonnegativeInteger(row, "failed_commands");
  const entries = nonnegativeInteger(row, "entries");
  const exactEntries = nonnegativeInteger(row, "exact_entries");
  const changes = nonnegativeInteger(row, "changes");
  const outbox = nonnegativeInteger(row, "outbox_rows");
  const empty =
    commands === 0 &&
    completed === 0 &&
    failed === 0 &&
    entries === 0 &&
    exactEntries === 0 &&
    changes === 0 &&
    outbox === 0;
  const completedShape =
    commands === 1 &&
    completed === 1 &&
    failed === 0 &&
    entries === 1 &&
    exactEntries === 1 &&
    changes === 1 &&
    outbox === 2;
  const failedShape =
    commands === 1 &&
    completed === 0 &&
    failed === 1 &&
    entries === 0 &&
    exactEntries === 0 &&
    changes === 0 &&
    outbox === 0;
  if (!empty && !completedShape && !failedShape) {
    throw new Error("Preview browser booking residue is not exact");
  }
  return Object.freeze({ completed: completedShape });
}

function exactAbuseKey(key) {
  if (
    !key ||
    !new Set(["availability", "booking"]).has(key.action) ||
    !new Set(["network", "account"]).has(key.scopeKind) ||
    key.hmacKeyId !== "public_v1" ||
    typeof key.scopeHashHex !== "string" ||
    !/^[0-9a-f]{64}$/u.test(key.scopeHashHex) ||
    typeof key.bucketStart !== "string" ||
    key.bucketStart.length < 20
  ) {
    throw new Error("Preview browser abuse cleanup key is invalid");
  }
  return key;
}

export async function cleanupPreviewBrowserResidue(sql, { abuseKeys, target }) {
  if (!Array.isArray(abuseKeys) || !target) {
    throw new Error("Preview browser cleanup input is invalid");
  }
  const keys = abuseKeys.map(exactAbuseKey);
  await sql.begin(async (transaction) => {
    await transaction.unsafe("set transaction isolation level serializable");
    const [row, ...extra] = await transaction.unsafe(CLEANUP_STATE_SQL, [
      PREVIEW_BOOKING_IDEMPOTENCY_KEY,
      target.localDate,
      target.serviceId,
      target.variantId,
      PREVIEW_BOOKING_PERSON.name,
      PREVIEW_BOOKING_PERSON.email,
      PREVIEW_BOOKING_PERSON.phone,
      PREVIEW_BOOKING_PERSON.note,
    ]);
    if (!row || extra.length !== 0) {
      throw new Error("Preview browser cleanup returned invalid rows");
    }
    assertPreviewBookingCleanupState(row);
    for (const key of keys) {
      const removed = await transaction.unsafe(
        `delete from gioia_private.public_abuse_buckets
         where action = $1::text and scope_kind = $2::text
           and hmac_key_id = $3::text and scope_hash = decode($4::text, 'hex')
           and bucket_start = $5::timestamptz returning 1`,
        [
          key.action,
          key.scopeKind,
          key.hmacKeyId,
          key.scopeHashHex,
          key.bucketStart,
        ],
      );
      if (removed.length !== 1) {
        throw new Error("Preview browser abuse residue changed before cleanup");
      }
    }
    await transaction.unsafe(
      `delete from gioia_private.email_outbox where aggregate_id in (
         select resource_id from gioia_private.command_requests
         where operation = 'public_booking' and idempotency_key = $1::text
       )`,
      [PREVIEW_BOOKING_IDEMPOTENCY_KEY],
    );
    await transaction.unsafe(
      `delete from gioia_private.domain_change_log where command_request_id in (
         select id from gioia_private.command_requests
         where operation = 'public_booking' and idempotency_key = $1::text
       )`,
      [PREVIEW_BOOKING_IDEMPOTENCY_KEY],
    );
    await transaction.unsafe(
      `delete from gioia_private.command_requests
       where operation = 'public_booking' and idempotency_key = $1::text`,
      [PREVIEW_BOOKING_IDEMPOTENCY_KEY],
    );
    await transaction.unsafe(
      `delete from gioia_private.schedule_entries
       where source = 'public' and local_date = $1::date
         and client_note = $2::text and client_email = $3::text`,
      [
        target.localDate,
        PREVIEW_BOOKING_PERSON.note,
        PREVIEW_BOOKING_PERSON.email,
      ],
    );
    await transaction.unsafe(
      `delete from gioia_private.schedule_day_locks
       where local_date = $1::date and not exists (
         select 1 from gioia_private.schedule_entries where local_date = $1::date
       ) and not exists (
         select 1 from gioia_private.vacations
         where status = 'active' and daterange(start_date, end_date, '[]') @> $1::date
       )`,
      [target.localDate],
    );
  });
}

export async function cleanupPreviewMaintenanceResidue(sql, freezeIds) {
  if (
    !Array.isArray(freezeIds) ||
    freezeIds.length > 2 ||
    new Set(freezeIds).size !== freezeIds.length ||
    freezeIds.some(
      (id) =>
        typeof id !== "string" ||
        !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu.test(
          id,
        ),
    )
  ) {
    throw new Error("Preview maintenance cleanup input is invalid");
  }
  if (freezeIds.length === 0) return;
  await sql.begin(async (transaction) => {
    await transaction.unsafe("set transaction isolation level serializable");
    const [state, ...extra] = await transaction.unsafe(
      `select mode, freeze_id,
         (select count(*)::integer from gioia_private.cutover_canary_runs)
           as canary_runs,
         (select count(*)::integer from gioia_private.cutover_canary_grants)
           as canary_grants,
         (select count(*)::integer from gioia_private.cutover_canary_events)
           as canary_events
       from gioia_private.cutover_write_control where singleton`,
    );
    if (
      !state ||
      extra.length !== 0 ||
      state.mode !== "open" ||
      state.freeze_id !== null ||
      Number(state.canary_runs) !== 0 ||
      Number(state.canary_grants) !== 0 ||
      Number(state.canary_events) !== 0
    ) {
      throw new Error("Preview maintenance did not return to the open state");
    }
    const transitions = await transaction.unsafe(
      `select freeze_id, from_mode, to_mode, reason_code
       from gioia_private.cutover_transition_log
       where freeze_id = any($1::uuid[]) order by freeze_id, sequence_id
       limit 8`,
      [freezeIds],
    );
    const allowedReasons = new Set([
      "PHASE4_PREVIEW_BROWSER",
      "PHASE4_PREVIEW_RECONCILE",
      "PHASE4_PREVIEW_ACCEPTED",
      "PHASE4_PREVIEW_TEST_CLEANUP_RECONCILE",
      "PHASE4_PREVIEW_TEST_CLEANUP_OPEN",
    ]);
    if (
      transitions.length !== freezeIds.length * 3 ||
      transitions.some(
        (row) =>
          !freezeIds.includes(row.freeze_id) ||
          !allowedReasons.has(row.reason_code) ||
          ![
            "open:frozen",
            "frozen:owner_reconcile",
            "owner_reconcile:open",
          ].includes(`${row.from_mode}:${row.to_mode}`),
      )
    ) {
      throw new Error("Preview maintenance transition residue is not exact");
    }
    for (const freezeId of freezeIds) {
      const rows = transitions.filter((row) => row.freeze_id === freezeId);
      if (
        rows.length !== 3 ||
        rows.map((row) => `${row.from_mode}:${row.to_mode}`).join("|") !==
          "open:frozen|frozen:owner_reconcile|owner_reconcile:open"
      ) {
        throw new Error("Preview maintenance transition residue is not exact");
      }
    }
    const removed = await transaction.unsafe(
      `delete from gioia_private.cutover_transition_log
       where freeze_id = any($1::uuid[]) returning freeze_id`,
      [freezeIds],
    );
    if (removed.length !== transitions.length) {
      throw new Error("Preview maintenance residue changed before cleanup");
    }
  });
}

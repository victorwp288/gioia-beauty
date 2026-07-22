export const PREVIEW_PRIVACY_PROBE = Object.freeze({
  name: "Cliente Privacy Preview Sintetica",
  email: "privacy.preview@example.test",
  legacyId: "phase4-preview-other-customer-v1",
});

function oneRow(rows, message) {
  if (!Array.isArray(rows) || rows.length !== 1) throw new Error(message);
  return rows[0];
}

export async function adoptPreviewPrivacyProbe(sql) {
  const rows = await sql.unsafe(
    `select id from gioia_private.schedule_entries
     where legacy_firestore_id = $1::text limit 2`,
    [PREVIEW_PRIVACY_PROBE.legacyId],
  );
  if (rows.length === 0) return null;
  const row = oneRow(rows, "Preview privacy probe adoption was not exact");
  return Object.freeze({ id: row.id, ...PREVIEW_PRIVACY_PROBE });
}

export async function plantPreviewPrivacyProbe(sql, target) {
  return sql.begin(async (transaction) => {
    await transaction.unsafe("set transaction isolation level serializable");
    await transaction.unsafe("set local lock_timeout = '5s'");
    await transaction.unsafe("set local statement_timeout = '30s'");
    const existing = await transaction.unsafe(
      `select id from gioia_private.schedule_entries
       where legacy_firestore_id = $1::text limit 2`,
      [PREVIEW_PRIVACY_PROBE.legacyId],
    );
    if (existing.length !== 0) {
      throw new Error("Preview privacy probe already exists");
    }
    const row = oneRow(
      await transaction.unsafe(
        `insert into gioia_private.schedule_entries (
           kind, status, source, local_date, start_minutes,
           service_duration_minutes, buffer_minutes, service_id, variant_id,
           service_name_snapshot, variant_name_snapshot, price_cents_snapshot,
           currency_snapshot, client_name, client_email, client_phone,
           client_note, created_by, legacy_firestore_id, timestamp_provenance,
           imported_at, cancelled_at, cancelled_by, cancellation_reason, version
         )
         select 'appointment', 'cancelled', 'migration', $1::date, 480,
           variant.duration_minutes, variant.buffer_minutes,
           service.id, variant.id, service.display_name_it,
           variant.display_name_it, variant.price_cents, variant.currency,
           $4::text, $5::extensions.citext, null, null, null, $6::text,
           'source', statement_timestamp(), statement_timestamp(), 'migration',
           'synthetic privacy boundary probe', 1
         from gioia_private.services as service
         join gioia_private.service_variants as variant
           on variant.service_id = service.id
         where service.id = $2::text and variant.id = $3::text
         returning id`,
        [
          target.localDate,
          target.serviceId,
          target.variantId,
          PREVIEW_PRIVACY_PROBE.name,
          PREVIEW_PRIVACY_PROBE.email,
          PREVIEW_PRIVACY_PROBE.legacyId,
        ],
      ),
      "Preview privacy probe insert was not exact",
    );
    if (typeof row.id !== "string") {
      throw new Error("Preview privacy probe returned an invalid id");
    }
    return Object.freeze({ id: row.id, ...PREVIEW_PRIVACY_PROBE });
  });
}

export async function cleanupPreviewPrivacyProbe(sql, probe, target) {
  await sql.begin(async (transaction) => {
    await transaction.unsafe("set transaction isolation level serializable");
    await transaction.unsafe("set local lock_timeout = '5s'");
    await transaction.unsafe("set local statement_timeout = '30s'");
    const row = oneRow(
      await transaction.unsafe(
        `select entry.id,
           (entry.schema_version = 1 and entry.kind = 'appointment'
             and entry.status = 'cancelled'
             and entry.source = 'migration' and entry.local_date = $2::date
             and entry.start_minutes = 480 and entry.service_id = $3::text
             and entry.variant_id = $4::text and entry.client_name = $5::text
             and entry.client_email::text = $6::text
             and entry.client_phone is null and entry.client_note is null
             and entry.internal_note is null
             and entry.created_by is null and entry.legacy_firestore_id = $7::text
             and entry.timestamp_provenance = 'source'
             and entry.imported_at is not null and entry.cancelled_at is not null
             and entry.cancelled_by = 'migration'
             and entry.cancellation_reason = 'synthetic privacy boundary probe'
             and entry.version = 1 and entry.created_at = entry.updated_at
             and entry.created_at = entry.imported_at
             and entry.imported_at = entry.cancelled_at
             and exists (
               select 1 from gioia_private.services as service
               join gioia_private.service_variants as variant
                 on variant.service_id = service.id
               where service.id = entry.service_id and variant.id = entry.variant_id
                 and entry.service_duration_minutes = variant.duration_minutes
                 and entry.buffer_minutes = variant.buffer_minutes
                 and entry.service_name_snapshot = service.display_name_it
                 and entry.variant_name_snapshot = variant.display_name_it
                 and entry.price_cents_snapshot is not distinct from variant.price_cents
                 and entry.currency_snapshot is not distinct from variant.currency
             )
           ) as exact,
           (select count(*)::integer from gioia_private.command_requests
             where resource_id = entry.id) as commands,
           (select count(*)::integer from gioia_private.domain_change_log
             where aggregate_id = entry.id) as changes,
           (select count(*)::integer from gioia_private.email_outbox
             where aggregate_id = entry.id) as outbox_rows
         from gioia_private.schedule_entries as entry
         where entry.id = $1::uuid for update`,
        [
          probe.id,
          target.localDate,
          target.serviceId,
          target.variantId,
          PREVIEW_PRIVACY_PROBE.name,
          PREVIEW_PRIVACY_PROBE.email,
          PREVIEW_PRIVACY_PROBE.legacyId,
        ],
      ),
      "Preview privacy probe is missing",
    );
    if (
      row.exact !== true ||
      Number(row.commands) !== 0 ||
      Number(row.changes) !== 0 ||
      Number(row.outbox_rows) !== 0
    ) {
      throw new Error("Preview privacy probe changed before cleanup");
    }
    const removed = await transaction.unsafe(
      `delete from gioia_private.schedule_entries
       where id = $1::uuid and legacy_firestore_id = $2::text returning id`,
      [probe.id, PREVIEW_PRIVACY_PROBE.legacyId],
    );
    if (removed.length !== 1) {
      throw new Error("Preview privacy probe cleanup was not exact");
    }
    await transaction.unsafe(
      `delete from gioia_private.schedule_day_locks
       where local_date = $1::date and not exists (
         select 1 from gioia_private.schedule_entries where local_date = $1::date
       ) and not exists (
         select 1 from gioia_private.vacations where status = 'active'
           and daterange(start_date, end_date, '[]') @> $1::date
       )`,
      [target.localDate],
    );
  });
}

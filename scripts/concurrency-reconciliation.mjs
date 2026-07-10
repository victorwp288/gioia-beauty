const LOCAL_DATE = /^\d{4}-\d{2}-\d{2}$/;
const UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function bookingReconciliationQuery({ note, keyPredicate }) {
  return `
    with appointments as (
      select id from gioia_private.schedule_entries
      where client_note = '${note}'
    )
    select
      (select count(*) from appointments)::integer as appointments,
      (select count(*) from gioia_private.email_outbox as outbox
        where outbox.aggregate_id in (select id from appointments))::integer
        as outbox_rows,
      (select count(*) from gioia_private.command_requests
        where operation = 'public_booking' and ${keyPredicate})::integer
        as command_rows,
      (select count(*) from gioia_private.command_requests
        where operation = 'public_booking' and ${keyPredicate}
          and state = 'completed')::integer as completed_commands,
      (select count(*) from gioia_private.command_requests
        where operation = 'public_booking' and ${keyPredicate}
          and state = 'failed')::integer as failed_commands,
      (select count(*) from gioia_private.domain_change_log
        where aggregate_id in (select id from appointments))::integer
        as domain_changes
  `;
}

export const distinctBookingReconciliationQuery = bookingReconciliationQuery({
  note: "synthetic-distinct-key-race",
  keyPredicate: "idempotency_key like 'race-distinct-%'",
});

export const identicalBookingReconciliationQuery = bookingReconciliationQuery({
  note: "synthetic-identical-key-race",
  keyPredicate: "idempotency_key = 'race-identical-key'",
});

export const bookingVacationReconciliationQuery = `
  with appointments as (
    select id from gioia_private.schedule_entries
    where client_note = 'synthetic-booking-vacation-race'
  ), vacation_rows as (
    select id from gioia_private.vacations
    where reason = 'Synthetic booking vacation race'
  ), aggregates as (
    select id from appointments union all select id from vacation_rows
  ), race_commands as (
    select state from gioia_private.command_requests
    where idempotency_key in (
      'race-booking-vacation-book', 'race-booking-vacation-close'
    )
  )
  select
    (select count(*) from appointments)::integer as appointments,
    (select count(*) from vacation_rows)::integer as vacations,
    (select count(*) from gioia_private.email_outbox
      where aggregate_id in (select id from appointments))::integer as outbox_rows,
    (select count(*) from race_commands)::integer as command_rows,
    (select count(*) from race_commands where state = 'completed')::integer
      as completed_commands,
    (select count(*) from race_commands where state = 'failed')::integer
      as failed_commands,
    (select count(*) from gioia_private.domain_change_log
      where aggregate_id in (select id from aggregates))::integer as domain_changes
`;

export function oppositeRescheduleReconciliationQuery({
  entryA,
  entryB,
  dateA,
  dateB,
}) {
  if (
    !UUID.test(entryA) ||
    !UUID.test(entryB) ||
    entryA === entryB ||
    !LOCAL_DATE.test(dateA) ||
    !LOCAL_DATE.test(dateB) ||
    dateA === dateB
  ) {
    throw new Error("Invalid opposite-reschedule reconciliation target");
  }
  return `
    with expected(id, local_date) as (
      values ('${entryA}'::uuid, '${dateA}'::date),
        ('${entryB}'::uuid, '${dateB}'::date)
    ), entries as (
      select entry.* from gioia_private.schedule_entries as entry
      where entry.id in ('${entryA}'::uuid, '${entryB}'::uuid)
    ), race_commands as (
      select state from gioia_private.command_requests
      where idempotency_key in (
        'race-swap-reschedule-a', 'race-swap-reschedule-b'
      )
    )
    select
      (select count(*) from entries)::integer as entries,
      (select count(*) from entries join expected using (id)
        where entries.local_date = expected.local_date
          and entries.start_minutes = 600)::integer as original_positions,
      (select count(*) from entries where version = 1)::integer as original_versions,
      (select count(*) from entries as left_entry
        join entries as right_entry on left_entry.id < right_entry.id
          and left_entry.local_date = right_entry.local_date
          and left_entry.occupied_span && right_entry.occupied_span)::integer as overlaps,
      (select count(*) from race_commands)::integer as command_rows,
      (select count(*) from race_commands where state = 'failed')::integer
        as failed_commands,
      (select count(*) from gioia_private.domain_change_log
        where aggregate_id in ('${entryA}'::uuid, '${entryB}'::uuid)
          and change_kind = 'reschedule')::integer as reschedule_changes,
      (select count(*) from gioia_private.email_outbox
        where aggregate_id in ('${entryA}'::uuid, '${entryB}'::uuid)
          and template_kind in ('reschedule_customer', 'reschedule_owner'))::integer
        as reschedule_outbox
  `;
}

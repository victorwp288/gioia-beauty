import "server-only";

export type OwnerCommandFailureStatus = 400 | 404 | 409;
export type OwnerScheduleCommandOperation =
  | "owner_create_appointment"
  | "owner_create_block"
  | "owner_cancel_schedule_entry"
  | "owner_create_vacation"
  | "owner_update_vacation"
  | "owner_cancel_vacation"
  | "owner_reschedule_appointment"
  | "owner_reschedule_block"
  | "owner_set_appointment_status"
  | "owner_update_appointment_details"
  | "owner_update_block_details";
export type OwnerCommandOperation =
  | OwnerScheduleCommandOperation
  | "owner_outbox_retry"
  | "owner_unsubscribe_subscriber";

export interface OwnerCommandContract {
  readonly operation: OwnerCommandOperation;
  readonly fingerprintVersion: 1;
  readonly query: string;
  readonly httpStatus: 200 | 201;
  readonly code: string;
  readonly failures: readonly string[];
}

export interface OwnerScheduleCommandContract extends OwnerCommandContract {
  readonly operation: OwnerScheduleCommandOperation;
}

export function ownerCommandFailureKey(
  status: OwnerCommandFailureStatus,
  code: string,
): string {
  return `${status}:${code}`;
}

function failures(
  entries: ReadonlyArray<readonly [string, OwnerCommandFailureStatus]>,
) {
  return Object.freeze(
    entries.map(([code, status]) => ownerCommandFailureKey(status, code)),
  );
}

export const OWNER_SCHEDULE_COMMAND_CONTRACTS = Object.freeze({
  createAppointment: Object.freeze({
    operation: "owner_create_appointment",
    fingerprintVersion: 1,
    query: `
      select command.http_status, command.result, command.replayed
      from gioia_private.owner_create_appointment(
        $1::uuid, $2::text, $3::bytea, $4::date, $5::smallint,
        $6::text, $7::text, $8::text, $9::text, $10::text, $11::text
      ) as command
      limit 2
    `,
    httpStatus: 201,
    code: "APPOINTMENT_CREATED",
    failures: failures([
      ["APPOINTMENT_CONTACT_INVALID", 400],
      ["OWNER_SLOT_INVALID", 400],
      ["OWNER_DATE_IN_PAST", 400],
      ["SLOT_ALIGNMENT_INVALID", 400],
      ["OWNER_START_IN_PAST", 400],
      ["SCHEDULE_INTERVAL_INVALID", 400],
      ["ACTIVE_VARIANT_NOT_FOUND", 404],
      ["SLOT_OUTSIDE_BUSINESS_HOURS", 409],
      ["DATE_CLOSED_FOR_VACATION", 409],
      ["SLOT_UNAVAILABLE", 409],
    ]),
  }),
  createBlock: Object.freeze({
    operation: "owner_create_block",
    fingerprintVersion: 1,
    query: `
      select command.http_status, command.result, command.replayed
      from gioia_private.owner_create_block(
        $1::uuid, $2::text, $3::bytea, $4::date, $5::smallint,
        $6::smallint, $7::smallint, $8::text
      ) as command
      limit 2
    `,
    httpStatus: 201,
    code: "BLOCK_CREATED",
    failures: failures([
      ["BLOCK_NOTE_INVALID", 400],
      ["OWNER_SLOT_INVALID", 400],
      ["OWNER_DATE_IN_PAST", 400],
      ["SLOT_ALIGNMENT_INVALID", 400],
      ["OWNER_START_IN_PAST", 400],
      ["SCHEDULE_INTERVAL_INVALID", 400],
      ["SLOT_OUTSIDE_BUSINESS_HOURS", 409],
      ["DATE_CLOSED_FOR_VACATION", 409],
      ["SLOT_UNAVAILABLE", 409],
    ]),
  }),
  updateAppointment: Object.freeze({
    operation: "owner_update_appointment_details",
    fingerprintVersion: 1,
    query: `
      select command.http_status, command.result, command.replayed
      from gioia_private.owner_update_appointment_details(
        $1::uuid, $2::text, $3::bytea, $4::uuid, $5::integer, $6::jsonb
      ) as command
      limit 2
    `,
    httpStatus: 200,
    code: "APPOINTMENT_DETAILS_UPDATED",
    failures: failures([
      ["APPOINTMENT_DETAILS_INVALID", 400],
      ["APPOINTMENT_DETAILS_NO_CHANGE", 400],
      ["APPOINTMENT_NOT_FOUND", 404],
      ["VERSION_CONFLICT", 409],
    ]),
  }),
  updateBlock: Object.freeze({
    operation: "owner_update_block_details",
    fingerprintVersion: 1,
    query: `
      select command.http_status, command.result, command.replayed
      from gioia_private.owner_update_block_details(
        $1::uuid, $2::text, $3::bytea, $4::uuid, $5::integer, $6::text
      ) as command
      limit 2
    `,
    httpStatus: 200,
    code: "BLOCK_DETAILS_UPDATED",
    failures: failures([
      ["BLOCK_DETAILS_INVALID", 400],
      ["BLOCK_DETAILS_NO_CHANGE", 400],
      ["BLOCK_NOT_FOUND", 404],
      ["VERSION_CONFLICT", 409],
    ]),
  }),
  rescheduleAppointment: Object.freeze({
    operation: "owner_reschedule_appointment",
    fingerprintVersion: 1,
    query: `
      select command.http_status, command.result, command.replayed
      from gioia_private.owner_reschedule_appointment(
        $1::uuid, $2::text, $3::bytea, $4::uuid, $5::integer,
        $6::date, $7::smallint, $8::text, $9::text
      ) as command
      limit 2
    `,
    httpStatus: 200,
    code: "APPOINTMENT_RESCHEDULED",
    failures: failures([
      ["RESCHEDULE_NO_CHANGE", 400],
      ["OWNER_SLOT_INVALID", 400],
      ["OWNER_DATE_IN_PAST", 400],
      ["SLOT_ALIGNMENT_INVALID", 400],
      ["OWNER_START_IN_PAST", 400],
      ["SCHEDULE_INTERVAL_INVALID", 400],
      ["APPOINTMENT_NOT_FOUND", 404],
      ["ACTIVE_VARIANT_NOT_FOUND", 404],
      ["VERSION_CONFLICT", 409],
      ["APPOINTMENT_NOT_RESCHEDULABLE", 409],
      ["SLOT_OUTSIDE_BUSINESS_HOURS", 409],
      ["DATE_CLOSED_FOR_VACATION", 409],
      ["SLOT_UNAVAILABLE", 409],
    ]),
  }),
  rescheduleBlock: Object.freeze({
    operation: "owner_reschedule_block",
    fingerprintVersion: 1,
    query: `
      select command.http_status, command.result, command.replayed
      from gioia_private.owner_reschedule_block(
        $1::uuid, $2::text, $3::bytea, $4::uuid, $5::integer,
        $6::date, $7::smallint, $8::smallint, $9::smallint
      ) as command
      limit 2
    `,
    httpStatus: 200,
    code: "BLOCK_RESCHEDULED",
    failures: failures([
      ["RESCHEDULE_NO_CHANGE", 400],
      ["OWNER_SLOT_INVALID", 400],
      ["OWNER_DATE_IN_PAST", 400],
      ["SLOT_ALIGNMENT_INVALID", 400],
      ["OWNER_START_IN_PAST", 400],
      ["SCHEDULE_INTERVAL_INVALID", 400],
      ["BLOCK_NOT_FOUND", 404],
      ["VERSION_CONFLICT", 409],
      ["BLOCK_NOT_RESCHEDULABLE", 409],
      ["SLOT_OUTSIDE_BUSINESS_HOURS", 409],
      ["DATE_CLOSED_FOR_VACATION", 409],
      ["SLOT_UNAVAILABLE", 409],
    ]),
  }),
  setAppointmentStatus: Object.freeze({
    operation: "owner_set_appointment_status",
    fingerprintVersion: 1,
    query: `
      select command.http_status, command.result, command.replayed
      from gioia_private.owner_set_appointment_status(
        $1::uuid, $2::text, $3::bytea, $4::uuid, $5::integer, $6::text
      ) as command
      limit 2
    `,
    httpStatus: 200,
    code: "APPOINTMENT_STATUS_UPDATED",
    failures: failures([
      ["STATUS_TRANSITION_INVALID", 400],
      ["APPOINTMENT_NOT_FOUND", 404],
      ["VERSION_CONFLICT", 409],
      ["STATUS_TRANSITION_INVALID", 409],
      ["SLOT_UNAVAILABLE", 409],
    ]),
  }),
  cancelScheduleEntry: Object.freeze({
    operation: "owner_cancel_schedule_entry",
    fingerprintVersion: 1,
    query: `
      select command.http_status, command.result, command.replayed
      from gioia_private.owner_cancel_schedule_entry(
        $1::uuid, $2::text, $3::bytea, $4::uuid, $5::integer, $6::text
      ) as command
      limit 2
    `,
    httpStatus: 200,
    code: "SCHEDULE_ENTRY_CANCELLED",
    failures: failures([
      ["CANCELLATION_REASON_INVALID", 400],
      ["SCHEDULE_ENTRY_NOT_FOUND", 404],
      ["VERSION_CONFLICT", 409],
      ["SCHEDULE_ENTRY_NOT_CANCELLABLE", 409],
      ["SLOT_UNAVAILABLE", 409],
    ]),
  }),
  createVacation: Object.freeze({
    operation: "owner_create_vacation",
    fingerprintVersion: 1,
    query: `
      select command.http_status, command.result, command.replayed
      from gioia_private.owner_create_vacation(
        $1::uuid, $2::text, $3::bytea, $4::date, $5::date, $6::text
      ) as command
      limit 2
    `,
    httpStatus: 201,
    code: "VACATION_CREATED",
    failures: failures([
      ["VACATION_REASON_INVALID", 400],
      ["VACATION_DATE_RANGE_INVALID", 400],
      ["VACATION_DATE_IN_PAST", 400],
      ["VACATION_CONFLICTS_WITH_SCHEDULE", 409],
      ["VACATION_OVERLAP", 409],
    ]),
  }),
  updateVacation: Object.freeze({
    operation: "owner_update_vacation",
    fingerprintVersion: 1,
    query: `
      select command.http_status, command.result, command.replayed
      from gioia_private.owner_update_vacation(
        $1::uuid, $2::text, $3::bytea, $4::uuid, $5::integer,
        $6::date, $7::date, $8::text
      ) as command
      limit 2
    `,
    httpStatus: 200,
    code: "VACATION_UPDATED",
    failures: failures([
      ["VACATION_REASON_INVALID", 400],
      ["VACATION_DATE_RANGE_INVALID", 400],
      ["VACATION_DATE_IN_PAST", 400],
      ["VACATION_NOT_FOUND", 404],
      ["VERSION_CONFLICT", 409],
      ["VACATION_NOT_EDITABLE", 409],
      ["VACATION_NO_CHANGE", 409],
      ["VACATION_CONFLICTS_WITH_SCHEDULE", 409],
      ["VACATION_OVERLAP", 409],
    ]),
  }),
  cancelVacation: Object.freeze({
    operation: "owner_cancel_vacation",
    fingerprintVersion: 1,
    query: `
      select command.http_status, command.result, command.replayed
      from gioia_private.owner_cancel_vacation(
        $1::uuid, $2::text, $3::bytea, $4::uuid, $5::integer
      ) as command
      limit 2
    `,
    httpStatus: 200,
    code: "VACATION_CANCELLED",
    failures: failures([
      ["VACATION_NOT_FOUND", 404],
      ["VERSION_CONFLICT", 409],
      ["VACATION_NOT_CANCELLABLE", 409],
    ]),
  }),
} satisfies Record<string, OwnerScheduleCommandContract>);

export const OWNER_SUBSCRIBER_UNSUBSCRIBE_CONTRACT = Object.freeze({
  operation: "owner_unsubscribe_subscriber",
  fingerprintVersion: 1,
  query: `
    select command.http_status, command.result, command.replayed
    from gioia_private.owner_unsubscribe_subscriber(
      $1::uuid, $2::text, $3::bytea, $4::uuid, $5::integer
    ) as command
    limit 2
  `,
  httpStatus: 200,
  code: "SUBSCRIBER_UNSUBSCRIBED",
  failures: failures([
    ["SUBSCRIBER_NOT_FOUND", 404],
    ["VERSION_CONFLICT", 409],
    ["SUBSCRIBER_NOT_UNSUBSCRIBABLE", 409],
  ]),
} satisfies OwnerCommandContract);

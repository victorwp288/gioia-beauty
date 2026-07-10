import "server-only";

export type OwnerCommandFailureStatus = 400 | 404 | 409;

export interface OwnerScheduleCommandContract {
  readonly query: string;
  readonly httpStatus: 200 | 201;
  readonly code: string;
  readonly failures: ReadonlyMap<string, OwnerCommandFailureStatus>;
}

function failures(
  entries: ReadonlyArray<readonly [string, OwnerCommandFailureStatus]>,
) {
  return new Map<string, OwnerCommandFailureStatus>(entries);
}

export const OWNER_SCHEDULE_COMMAND_CONTRACTS = Object.freeze({
  createAppointment: Object.freeze({
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
  cancelScheduleEntry: Object.freeze({
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
  cancelVacation: Object.freeze({
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

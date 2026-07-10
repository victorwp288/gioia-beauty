const REQUEST_COUNT = 20;
const UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function numberField(row, field) {
  const value = Number(row?.[field]);
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new Error(`Invalid ${field} count`);
  }
  return value;
}

function resultCount(results, predicate) {
  return results.filter(predicate).length;
}

export function assertDistinctKeyBookingRace(results, reconciliation) {
  const accepted = resultCount(
    results,
    (row) => Number(row.http_status) === 201 && row.code === "BOOKING_CREATED",
  );
  const conflicts = resultCount(
    results,
    (row) => Number(row.http_status) === 409 && row.code === "SLOT_UNAVAILABLE",
  );
  const replayed = resultCount(results, (row) => row.replayed === true);

  if (
    results.length !== REQUEST_COUNT ||
    accepted !== 1 ||
    conflicts !== REQUEST_COUNT - 1 ||
    replayed !== 0
  ) {
    throw new Error(
      `Exactly one booking must win: accepted=${accepted}, conflicts=${conflicts}, replayed=${replayed}`,
    );
  }

  const appointments = numberField(reconciliation, "appointments");
  const outbox = numberField(reconciliation, "outbox_rows");
  const commands = numberField(reconciliation, "command_rows");
  const completed = numberField(reconciliation, "completed_commands");
  const failed = numberField(reconciliation, "failed_commands");
  const changes = numberField(reconciliation, "domain_changes");
  if (
    appointments !== 1 ||
    outbox !== 2 ||
    commands !== REQUEST_COUNT ||
    completed !== 1 ||
    failed !== REQUEST_COUNT - 1 ||
    changes !== 1
  ) {
    throw new Error("Distinct-key booking reconciliation failed");
  }

  return { accepted, conflicts, appointments, outbox, commands, changes };
}

export const assertConcurrencyResults = assertDistinctKeyBookingRace;

export function assertIdenticalKeyReplayRace(results, reconciliation) {
  const firstExecutions = resultCount(results, (row) => row.replayed === false);
  const replays = resultCount(results, (row) => row.replayed === true);
  const invalid = results.some(
    (row) => Number(row.http_status) !== 201 || row.code !== "BOOKING_CREATED",
  );
  if (
    results.length !== REQUEST_COUNT ||
    firstExecutions !== 1 ||
    replays !== REQUEST_COUNT - 1 ||
    invalid
  ) {
    throw new Error(
      `Identical requests must converge: first=${firstExecutions}, replays=${replays}`,
    );
  }

  const appointments = numberField(reconciliation, "appointments");
  const outbox = numberField(reconciliation, "outbox_rows");
  const commands = numberField(reconciliation, "command_rows");
  const completed = numberField(reconciliation, "completed_commands");
  const failed = numberField(reconciliation, "failed_commands");
  const changes = numberField(reconciliation, "domain_changes");
  if (
    appointments !== 1 ||
    outbox !== 2 ||
    commands !== 1 ||
    completed !== 1 ||
    failed !== 0 ||
    changes !== 1
  ) {
    throw new Error("Identical-key replay reconciliation failed");
  }

  return { firstExecutions, replays, appointments, outbox, commands, changes };
}

export function assertBookingVacationRace(results, reconciliation) {
  const codes = new Set(results.map((row) => String(row.code)));
  const bookingWon = codes.has("BOOKING_CREATED");
  const vacationWon = codes.has("VACATION_CREATED");
  const expectedConflict = bookingWon
    ? "VACATION_CONFLICTS_WITH_SCHEDULE"
    : "DATE_CLOSED_FOR_VACATION";
  const statuses = results.map((row) => Number(row.http_status)).sort();

  if (
    results.length !== 2 ||
    bookingWon === vacationWon ||
    !codes.has(expectedConflict) ||
    statuses[0] !== 201 ||
    statuses[1] !== 409 ||
    results.some((row) => row.replayed !== false)
  ) {
    throw new Error("Booking-vacation race did not serialize to one winner");
  }

  const appointments = numberField(reconciliation, "appointments");
  const vacations = numberField(reconciliation, "vacations");
  const outbox = numberField(reconciliation, "outbox_rows");
  const commands = numberField(reconciliation, "command_rows");
  const completed = numberField(reconciliation, "completed_commands");
  const failed = numberField(reconciliation, "failed_commands");
  const changes = numberField(reconciliation, "domain_changes");
  if (
    appointments + vacations !== 1 ||
    appointments !== Number(bookingWon) ||
    vacations !== Number(vacationWon) ||
    outbox !== (bookingWon ? 2 : 0) ||
    commands !== 2 ||
    completed !== 1 ||
    failed !== 1 ||
    changes !== 1
  ) {
    throw new Error("Booking-vacation reconciliation failed");
  }

  return { winner: bookingWon ? "booking" : "vacation", outbox, changes };
}

export function parseCreatedAppointment(row) {
  const resourceId = String(row?.resource_id ?? "");
  if (
    Number(row?.http_status) !== 201 ||
    row?.code !== "APPOINTMENT_CREATED" ||
    row?.replayed !== false ||
    !UUID.test(resourceId)
  ) {
    throw new Error("Owner appointment fixture creation failed");
  }
  return resourceId;
}

export function assertOppositeRescheduleRace(results, reconciliation) {
  if (
    results.length !== 2 ||
    results.some(
      (row) =>
        Number(row.http_status) !== 409 ||
        row.code !== "SLOT_UNAVAILABLE" ||
        row.replayed !== false,
    )
  ) {
    throw new Error("Opposite reschedules must both conflict without deadlock");
  }

  const entries = numberField(reconciliation, "entries");
  const originalPositions = numberField(reconciliation, "original_positions");
  const originalVersions = numberField(reconciliation, "original_versions");
  const overlaps = numberField(reconciliation, "overlaps");
  const commands = numberField(reconciliation, "command_rows");
  const failed = numberField(reconciliation, "failed_commands");
  const rescheduleChanges = numberField(reconciliation, "reschedule_changes");
  const rescheduleOutbox = numberField(reconciliation, "reschedule_outbox");
  if (
    entries !== 2 ||
    originalPositions !== 2 ||
    originalVersions !== 2 ||
    overlaps !== 0 ||
    commands !== 2 ||
    failed !== 2 ||
    rescheduleChanges !== 0 ||
    rescheduleOutbox !== 0
  ) {
    throw new Error("Opposite-reschedule reconciliation failed");
  }

  return { entries, originalPositions, failed };
}

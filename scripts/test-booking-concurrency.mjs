import { fileURLToPath } from "node:url";

import {
  assertBookingVacationRace,
  assertDistinctKeyBookingRace,
  assertIdenticalKeyReplayRace,
  assertOppositeRescheduleRace,
  parseCreatedAppointment,
} from "./concurrency-assertions.mjs";
import {
  queryOne,
  runConcurrentRuntimeQueries,
  runRuntimeQuery,
  withLocalRuntimeDatabase,
} from "./concurrency-harness.mjs";
import {
  bookingQuery,
  bookingVacationBookingQuery,
  bookingVacationVacationQuery,
  identicalBookingQuery,
  ownerCreateAppointmentQuery,
  ownerFixtureQueries,
  ownerRescheduleQuery,
  parseRaceTargets,
  raceTargetQuery,
  REQUEST_COUNT,
} from "./concurrency-queries.mjs";
import {
  bookingVacationReconciliationQuery,
  distinctBookingReconciliationQuery,
  identicalBookingReconciliationQuery,
  oppositeRescheduleReconciliationQuery,
} from "./concurrency-reconciliation.mjs";

export * from "./concurrency-assertions.mjs";
export * from "./concurrency-harness.mjs";
export * from "./concurrency-queries.mjs";
export * from "./concurrency-reconciliation.mjs";

async function runDistinctKeyRace(sql, target) {
  const results = await runConcurrentRuntimeQueries(
    sql,
    Array.from({ length: REQUEST_COUNT }, (_, index) =>
      bookingQuery(index + 1, target),
    ),
  );
  const reconciliation = await queryOne(
    sql,
    distinctBookingReconciliationQuery,
  );
  const summary = assertDistinctKeyBookingRace(results, reconciliation);
  process.stdout.write(
    `Distinct-key race passed: accepted=${summary.accepted}, ` +
      `conflicts=${summary.conflicts}, commands=${summary.commands}.\n`,
  );
}

async function runIdenticalKeyRace(sql, target) {
  const query = identicalBookingQuery(target);
  const results = await runConcurrentRuntimeQueries(
    sql,
    Array.from({ length: REQUEST_COUNT }, () => query),
  );
  const reconciliation = await queryOne(
    sql,
    identicalBookingReconciliationQuery,
  );
  const summary = assertIdenticalKeyReplayRace(results, reconciliation);
  process.stdout.write(
    `Identical-key race passed: first=${summary.firstExecutions}, ` +
      `replays=${summary.replays}, commands=${summary.commands}.\n`,
  );
}

async function runBookingVacationRace(sql, target) {
  const results = await runConcurrentRuntimeQueries(sql, [
    bookingVacationBookingQuery(target),
    bookingVacationVacationQuery(target),
  ]);
  const reconciliation = await queryOne(
    sql,
    bookingVacationReconciliationQuery,
  );
  const summary = assertBookingVacationRace(results, reconciliation);
  process.stdout.write(
    `Booking-vacation race passed: winner=${summary.winner}, ` +
      `outbox=${summary.outbox}, changes=${summary.changes}.\n`,
  );
}

async function createSwapFixture(sql, target, suffix, fingerprintByte) {
  const rows = await runRuntimeQuery(
    sql,
    ownerCreateAppointmentQuery(target, suffix, fingerprintByte),
  );
  if (rows.length !== 1) {
    throw new Error("Owner appointment fixture returned an invalid row count");
  }
  return parseCreatedAppointment(rows[0]);
}

async function runOppositeRescheduleRace(sql, targetA, targetB) {
  const entryA = await createSwapFixture(sql, targetA, "a", "41");
  const entryB = await createSwapFixture(sql, targetB, "b", "42");
  const results = await runConcurrentRuntimeQueries(sql, [
    ownerRescheduleQuery({
      entryId: entryA,
      target: targetB,
      suffix: "a",
      fingerprintByte: "43",
    }),
    ownerRescheduleQuery({
      entryId: entryB,
      target: targetA,
      suffix: "b",
      fingerprintByte: "44",
    }),
  ]);
  const reconciliation = await queryOne(
    sql,
    oppositeRescheduleReconciliationQuery({
      entryA,
      entryB,
      dateA: targetA.localDate,
      dateB: targetB.localDate,
    }),
  );
  const summary = assertOppositeRescheduleRace(results, reconciliation);
  process.stdout.write(
    `Opposite-reschedule race passed: originals=${summary.originalPositions}, ` +
      `failed=${summary.failed}, overlaps=0.\n`,
  );
}

async function main() {
  await withLocalRuntimeDatabase(async (sql) => {
    const targets = parseRaceTargets(await sql.unsafe(raceTargetQuery));
    for (const query of ownerFixtureQueries) await sql.unsafe(query);
    await runDistinctKeyRace(sql, targets[0]);
    await runIdenticalKeyRace(sql, targets[1]);
    await runBookingVacationRace(sql, targets[2]);
    await runOppositeRescheduleRace(sql, targets[3], targets[4]);
  });
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  try {
    await main();
  } catch (error) {
    process.stderr.write(
      `Concurrency test failed: ${error instanceof Error ? error.message : String(error)}\n`,
    );
    process.exitCode = 1;
  }
}

import { execFile } from "node:child_process";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const REQUEST_COUNT = 20;
const CATALOG_ID = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const LOCAL_DATE = /^\d{4}-\d{2}-\d{2}$/;
const supabaseBinary = path.join(
  process.cwd(),
  "node_modules",
  ".bin",
  "supabase",
);
const databaseCommandOptions = {
  env: { ...process.env, SUPABASE_TELEMETRY_DISABLED: "1" },
  maxBuffer: 1024 * 1024,
  timeout: 30_000,
};

async function executeLocalDatabase(query) {
  await execFileAsync(
    supabaseBinary,
    ["db", "query", "--local", query],
    databaseCommandOptions,
  );
}

async function queryLocalDatabase(query) {
  const { stdout } = await execFileAsync(
    supabaseBinary,
    ["db", "query", "--local", "--output", "json", query],
    databaseCommandOptions,
  );
  const parsed = JSON.parse(stdout);
  if (!Array.isArray(parsed))
    throw new Error("Database query did not return rows");
  return parsed;
}

export const raceTargetQuery = `
  with target_date as (
    select (
      (statement_timestamp() at time zone 'Europe/Rome')::date + candidate.days
    )::date as local_date
    from pg_catalog.generate_series(1, 14) as candidate(days)
    where exists (
      select 1 from gioia_private.business_hours as hours
      where hours.weekday = extract(
        isodow from (
          statement_timestamp() at time zone 'Europe/Rome'
        )::date + candidate.days
      )::smallint
    )
    order by candidate.days
    limit 1
  ), target_variant as (
    select service.id as service_id, variant.id as variant_id
    from gioia_private.service_variants as variant
    join gioia_private.services as service on service.id = variant.service_id
    join gioia_private.service_categories as category
      on category.id = service.category_id
    where variant.active and service.active and category.active
    order by variant.duration_minutes + variant.buffer_minutes,
      service.id, variant.id
    limit 1
  )
  select target_date.local_date::text as local_date, target_variant.service_id,
    target_variant.variant_id
  from target_date
  cross join target_variant
`;

export function parseRaceTarget(row) {
  const localDate = String(row?.local_date ?? "");
  const serviceId = String(row?.service_id ?? "");
  const variantId = String(row?.variant_id ?? "");
  if (
    !LOCAL_DATE.test(localDate) ||
    !CATALOG_ID.test(serviceId) ||
    !CATALOG_ID.test(variantId)
  ) {
    throw new Error("Concurrency target query returned invalid identifiers");
  }
  return { localDate, serviceId, variantId };
}

export function bookingQuery(requestNumber, target) {
  const idempotencyKey = `concurrency-race-${String(requestNumber).padStart(2, "0")}`;
  const { localDate, serviceId, variantId } = parseRaceTarget({
    local_date: target.localDate,
    service_id: target.serviceId,
    variant_id: target.variantId,
  });
  return `
    set role app_runtime;
    select booking.http_status, booking.result ->> 'code' as code,
      booking.replayed
    from gioia_private.create_public_booking(
      decode(repeat('11', 32), 'hex'),
      '${idempotencyKey}',
      decode(repeat('21', 32), 'hex'),
      '${localDate}'::date,
      600::smallint,
      '${serviceId}',
      '${variantId}',
      'Synthetic Concurrency',
      'concurrency@example.test',
      '+390000000000',
      'synthetic-concurrency-fixture'
    ) as booking
  `;
}

function numberField(row, field) {
  const value = Number(row[field]);
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new Error(`Invalid ${field} count`);
  }
  return value;
}

export function assertConcurrencyResults(results, reconciliation) {
  const statuses = results.map((row) => Number(row.http_status));
  const accepted = statuses.filter((status) => status === 201).length;
  const conflicts = statuses.filter((status) => status === 409).length;
  const replayed = results.filter((row) => row.replayed === true).length;

  if (
    results.length !== REQUEST_COUNT ||
    accepted !== 1 ||
    conflicts !== REQUEST_COUNT - 1 ||
    replayed !== 0 ||
    results.some(
      (row) =>
        !["BOOKING_CREATED", "SLOT_UNAVAILABLE"].includes(String(row.code)),
    )
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
  if (
    appointments !== 1 ||
    outbox !== 2 ||
    commands !== REQUEST_COUNT ||
    completed !== 1 ||
    failed !== REQUEST_COUNT - 1
  ) {
    throw new Error(
      `Concurrency reconciliation failed: appointments=${appointments}, outbox=${outbox}, commands=${commands}, completed=${completed}, failed=${failed}`,
    );
  }

  return { accepted, conflicts, appointments, outbox, commands };
}

async function main() {
  const [targetRow] = await queryLocalDatabase(raceTargetQuery);
  if (!targetRow) throw new Error("Concurrency target query returned no row");
  const target = parseRaceTarget(targetRow);

  await executeLocalDatabase("grant app_runtime to postgres");
  let responses;
  try {
    responses = await Promise.all(
      Array.from({ length: REQUEST_COUNT }, (_, index) =>
        queryLocalDatabase(bookingQuery(index + 1, target)),
      ),
    );
  } finally {
    await executeLocalDatabase("revoke app_runtime from postgres");
  }
  const results = responses.flat();
  const [reconciliation] = await queryLocalDatabase(`
    select
      (select count(*) from gioia_private.schedule_entries
        where client_note = 'synthetic-concurrency-fixture')::integer
        as appointments,
      (select count(*) from gioia_private.email_outbox as outbox
        join gioia_private.schedule_entries as entry
          on entry.id = outbox.aggregate_id
        where entry.client_note = 'synthetic-concurrency-fixture')::integer
        as outbox_rows,
      (select count(*) from gioia_private.command_requests
        where operation = 'public_booking'
          and idempotency_key like 'concurrency-race-%')::integer
        as command_rows,
      (select count(*) from gioia_private.command_requests
        where operation = 'public_booking'
          and idempotency_key like 'concurrency-race-%'
          and state = 'completed')::integer as completed_commands,
      (select count(*) from gioia_private.command_requests
        where operation = 'public_booking'
          and idempotency_key like 'concurrency-race-%'
          and state = 'failed')::integer as failed_commands
  `);
  if (!reconciliation)
    throw new Error("Concurrency reconciliation returned no row");

  const summary = assertConcurrencyResults(results, reconciliation);
  process.stdout.write(
    `Concurrent booking invariant passed: accepted=${summary.accepted}, ` +
      `conflicts=${summary.conflicts}, appointments=${summary.appointments}, ` +
      `outbox=${summary.outbox}, commands=${summary.commands}.\n`,
  );
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

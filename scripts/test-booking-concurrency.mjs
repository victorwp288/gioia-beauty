import { execFile } from "node:child_process";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { promisify } from "node:util";
import postgres from "postgres";

const execFileAsync = promisify(execFile);
const REQUEST_COUNT = 20;
const CATALOG_ID = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const LOCAL_DATE = /^\d{4}-\d{2}-\d{2}$/;
export const RUNTIME_ROLE_SQL = "set local role app_runtime";
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

export function parseLocalDatabaseUrl(value) {
  try {
    const url = new URL(value);
    if (
      !["postgres:", "postgresql:"].includes(url.protocol) ||
      !["127.0.0.1", "localhost", "::1"].includes(url.hostname) ||
      url.username !== "postgres" ||
      url.pathname !== "/postgres"
    ) {
      throw new Error();
    }
    return value;
  } catch {
    throw new Error("Supabase status did not return a safe local database URL");
  }
}

async function getLocalDatabaseUrl() {
  const { stdout } = await execFileAsync(
    supabaseBinary,
    ["status", "-o", "json"],
    databaseCommandOptions,
  );
  const status = JSON.parse(stdout);
  return parseLocalDatabaseUrl(status.DB_URL);
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
  const databaseUrl = await getLocalDatabaseUrl();
  const sql = postgres(databaseUrl, {
    prepare: false,
    max: REQUEST_COUNT,
    idle_timeout: 5,
    connect_timeout: 5,
    max_lifetime: 60,
    onnotice: () => {},
  });
  let membershipGranted = false;
  try {
    const [targetRow] = await sql.unsafe(raceTargetQuery);
    if (!targetRow) throw new Error("Concurrency target query returned no row");
    const target = parseRaceTarget(targetRow);

    await sql.unsafe("grant app_runtime to postgres");
    membershipGranted = true;

    const settled = await Promise.allSettled(
      Array.from({ length: REQUEST_COUNT }, (_, index) =>
        sql.begin(async (transaction) => {
          await transaction.unsafe(RUNTIME_ROLE_SQL);
          await transaction.unsafe(
            "select set_config('statement_timeout', '8000', true), " +
              "set_config('lock_timeout', '3000', true)",
          );
          return transaction.unsafe(bookingQuery(index + 1, target));
        }),
      ),
    );
    const rejected = settled.find((result) => result.status === "rejected");
    if (rejected) throw rejected.reason;
    const results = settled.flatMap((result) => result.value);

    const [reconciliation] = await sql.unsafe(`
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
  } finally {
    try {
      if (membershipGranted) {
        await sql.unsafe("revoke app_runtime from postgres");
      }
    } finally {
      await sql.end({ timeout: 5 });
    }
  }
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

import { execFile } from "node:child_process";
import path from "node:path";
import { promisify } from "node:util";

import postgres from "postgres";

import { REQUEST_COUNT } from "./concurrency-queries.mjs";

const execFileAsync = promisify(execFile);
const BARRIER_TIMEOUT_MS = 10_000;
const BARRIER_POLL_MS = 10;
const BARRIER_KEY_ONE = 1_196_837_705;
const BARRIER_KEY_TWO = 1_112_492_071;
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

export const RUNTIME_ROLE_SQL = "set local role app_runtime";
export const COORDINATOR_BARRIER_SQL =
  `select pg_catalog.pg_try_advisory_xact_lock(` +
  `${BARRIER_KEY_ONE}, ${BARRIER_KEY_TWO}) as acquired`;
export const WORKER_BARRIER_SQL =
  `select pg_catalog.pg_advisory_xact_lock_shared(` +
  `${BARRIER_KEY_ONE}, ${BARRIER_KEY_TWO})`;
export const BARRIER_WAITERS_SQL = `
  select pg_catalog.count(*)::integer as waiting
  from pg_catalog.pg_locks
  where locktype = 'advisory'
    and database = (
      select oid from pg_catalog.pg_database
      where datname = pg_catalog.current_database()
    )
    and classid = ${BARRIER_KEY_ONE}::oid
    and objid = ${BARRIER_KEY_TWO}::oid
    and objsubid = 2
    and mode = 'ShareLock'
    and not granted
`;
export const DATABASE_POOL_SIZE = REQUEST_COUNT + 1;
const RUNTIME_TIMEOUT_SQL =
  "select set_config('statement_timeout', '8000', true), " +
  "set_config('lock_timeout', '3000', true)";

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
  return parseLocalDatabaseUrl(JSON.parse(stdout).DB_URL);
}

export function parseBarrierWaiterCount(row, expected) {
  const waiting = Number(row?.waiting);
  if (
    !Number.isSafeInteger(expected) ||
    expected < 2 ||
    expected > REQUEST_COUNT ||
    !Number.isSafeInteger(waiting) ||
    waiting < 0 ||
    waiting > expected
  ) {
    throw new Error("Concurrency barrier returned an invalid waiter count");
  }
  return waiting;
}

function pause(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

async function waitForWorkersAtBarrier(coordinator, expected) {
  const deadline = Date.now() + BARRIER_TIMEOUT_MS;
  let waiting = 0;
  while (Date.now() < deadline) {
    const rows = await coordinator.unsafe(BARRIER_WAITERS_SQL);
    if (rows.length !== 1) {
      throw new Error("Concurrency barrier waiter query returned invalid rows");
    }
    waiting = parseBarrierWaiterCount(rows[0], expected);
    if (waiting === expected) return;
    await pause(BARRIER_POLL_MS);
  }
  throw new Error(
    `Concurrency barrier timed out: waiting=${waiting}, expected=${expected}`,
  );
}

export async function runRuntimeQuery(sql, query, barrierState) {
  return sql.begin(async (transaction) => {
    await transaction.unsafe(RUNTIME_ROLE_SQL);
    if (barrierState) {
      await transaction.unsafe(WORKER_BARRIER_SQL);
      if (barrierState.aborted) {
        throw new Error("Concurrency barrier aborted before release");
      }
    }
    await transaction.unsafe(RUNTIME_TIMEOUT_SQL);
    return transaction.unsafe(query);
  });
}

export async function runConcurrentRuntimeQueries(sql, queries) {
  if (
    !Array.isArray(queries) ||
    queries.length < 2 ||
    queries.length > REQUEST_COUNT
  ) {
    throw new Error("Concurrency barrier requires two to twenty workers");
  }

  const barrierState = { aborted: false };
  let settledPromise;
  try {
    await sql.begin(async (coordinator) => {
      const [lock, ...extraLocks] = await coordinator.unsafe(
        COORDINATOR_BARRIER_SQL,
      );
      if (lock?.acquired !== true || extraLocks.length > 0) {
        throw new Error("Concurrency barrier is already in use");
      }
      const workers = queries.map((query) =>
        runRuntimeQuery(sql, query, barrierState),
      );
      settledPromise = Promise.allSettled(workers);
      try {
        await waitForWorkersAtBarrier(coordinator, queries.length);
      } catch (error) {
        barrierState.aborted = true;
        throw error;
      }
    });
  } catch (error) {
    barrierState.aborted = true;
    if (settledPromise) await settledPromise;
    throw error;
  }

  const settled = await settledPromise;
  const rejected = settled.find((result) => result.status === "rejected");
  if (rejected) throw rejected.reason;
  return settled.flatMap((result) => result.value);
}

export async function queryOne(sql, query) {
  const [row, ...extra] = await sql.unsafe(query);
  if (!row || extra.length > 0) {
    throw new Error("Concurrency reconciliation must return exactly one row");
  }
  return row;
}

export async function withLocalRuntimeDatabase(callback) {
  const databaseUrl = await getLocalDatabaseUrl();
  const sql = postgres(databaseUrl, {
    prepare: false,
    max: DATABASE_POOL_SIZE,
    idle_timeout: 5,
    connect_timeout: 5,
    max_lifetime: 60,
    onnotice: () => {},
  });
  let membershipGranted = false;
  try {
    await sql.unsafe("grant app_runtime to postgres");
    membershipGranted = true;
    return await callback(sql);
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

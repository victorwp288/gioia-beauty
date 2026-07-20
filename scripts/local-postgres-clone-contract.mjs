import { localSupabasePorts } from "./local-supabase-ports.mjs";

export const LOCAL_POSTGRES_HOST = "127.0.0.1";
export const LOCAL_POSTGRES_SOURCE_DATABASE = "postgres";
export const LOCAL_POSTGRES_USER = "postgres";
export const LOCAL_POSTGRES_RESTORE_USER = "supabase_admin";
export const LOCAL_POSTGRES_CLONE_DATABASE = "gioia_phase5_restore_rehearsal";
export const LOCAL_POSTGRES_MINIMUM_FREE_BYTES = 1024 ** 3;

const STATUS_KEYS = Object.freeze({
  api: ["API_URL", "apiUrl"],
  database: ["DB_URL", "dbUrl"],
});

function statusValue(status, keys, label) {
  for (const key of keys) {
    const value = status[key];
    if (typeof value === "string" && value.length > 0) return value;
  }
  throw new Error(`Local Supabase status is missing ${label}`);
}

function exactUrl(value, protocol, port, label) {
  let parsed;
  try {
    parsed = new URL(value);
  } catch {
    throw new Error(`Local Supabase ${label} is invalid`);
  }
  if (
    parsed.protocol !== protocol ||
    parsed.hostname !== LOCAL_POSTGRES_HOST ||
    parsed.port !== port ||
    parsed.hash !== ""
  ) {
    throw new Error(
      `Local Supabase ${label} is not the expected loopback target`,
    );
  }
  return parsed;
}

function decodeCredential(value) {
  try {
    return decodeURIComponent(value);
  } catch {
    throw new Error("Local Supabase database credentials are invalid");
  }
}

export function parseLocalSupabaseStatus(status, environment = process.env) {
  if (!status || typeof status !== "object" || Array.isArray(status)) {
    throw new Error("Local Supabase status must be an object");
  }
  const ports = localSupabasePorts(environment);
  const api = exactUrl(
    statusValue(status, STATUS_KEYS.api, "API URL"),
    "http:",
    ports.api,
    "API URL",
  );
  const database = exactUrl(
    statusValue(status, STATUS_KEYS.database, "database URL"),
    "postgresql:",
    ports.database,
    "database URL",
  );
  if (
    api.username !== "" ||
    api.password !== "" ||
    api.search !== "" ||
    (api.pathname !== "" && api.pathname !== "/")
  ) {
    throw new Error("Local Supabase API URL is not canonical");
  }
  if (
    decodeCredential(database.username) !== LOCAL_POSTGRES_USER ||
    database.pathname !== `/${LOCAL_POSTGRES_SOURCE_DATABASE}` ||
    database.search !== "" ||
    database.password.length === 0
  ) {
    throw new Error("Local Supabase database source or user is not canonical");
  }
  return Object.freeze({
    host: LOCAL_POSTGRES_HOST,
    port: ports.database,
    sourceDatabase: LOCAL_POSTGRES_SOURCE_DATABASE,
    targetDatabase: LOCAL_POSTGRES_CLONE_DATABASE,
    user: LOCAL_POSTGRES_USER,
    restoreUser: LOCAL_POSTGRES_RESTORE_USER,
    password: decodeCredential(database.password),
  });
}

export function postgresEnvironment(
  connection,
  database,
  user = connection.user,
) {
  if (![connection.user, connection.restoreUser].includes(user)) {
    throw new Error("Local Postgres clone user is not approved");
  }
  return Object.freeze({
    PGAPPNAME: "gioia_phase5_local_clone",
    PGCONNECT_TIMEOUT: "10",
    PGDATABASE: database,
    PGHOST: connection.host,
    PGPASSWORD: connection.password,
    PGPORT: connection.port,
    PGUSER: user,
  });
}

export function redactedConnection(connection, database) {
  return Object.freeze({
    database,
    host: connection.host,
    port: connection.port,
    user: connection.user,
  });
}

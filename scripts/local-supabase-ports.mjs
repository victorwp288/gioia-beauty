const PORT_PATTERN =
  /^(?:[1-9]|[1-9][0-9]{1,3}|[1-5][0-9]{4}|6[0-4][0-9]{3}|65[0-4][0-9]{2}|655[0-2][0-9]|6553[0-5])$/u;

function localPort(environment, key, fallback) {
  const candidate = environment[key];
  if (candidate === undefined || candidate === "") return fallback;
  if (typeof candidate !== "string" || !PORT_PATTERN.test(candidate)) {
    throw new Error(`${key} must be a canonical local TCP port`);
  }
  return candidate;
}

export function localSupabasePorts(environment = process.env) {
  return Object.freeze({
    api: localPort(environment, "GIOIA_LOCAL_SUPABASE_API_PORT", "54321"),
    database: localPort(environment, "GIOIA_LOCAL_SUPABASE_DB_PORT", "54322"),
  });
}

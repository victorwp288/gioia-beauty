import { readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";

export const TEST_TARGET_REF = "lxvsspniipcotimbsfqm";
export const TEST_TARGET_API_URL = `https://${TEST_TARGET_REF}.supabase.co`;
export const TEST_TARGET_REGION = "eu-central-2";

const PUBLISHABLE_KEY_PATTERN = /^sb_publishable_[A-Za-z0-9_-]{20,}$/;
const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const POOLER_HOST_PATTERN = /^aws-[0-9]+-eu-central-2\.pooler\.supabase\.com$/;
const OPERATOR_USERNAME = `postgres.${TEST_TARGET_REF}`;
const RUNTIME_USERNAME = `app_runtime.${TEST_TARGET_REF}`;
const ALLOWED_SUPABASE_ENV_KEYS = new Set([
  "NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY",
  "NEXT_PUBLIC_SUPABASE_URL",
  "SUPABASE_PROJECT_REF",
]);
const FORBIDDEN_EXACT_ENV_KEYS = new Set([
  "DATABASE_URL",
  "EMAIL_TRANSPORT",
  "GCLOUD_PROJECT",
  "GIOIA_PRODUCTION_APPROVAL_ID",
  "GIOIA_TEST_OWNER_PASSWORD",
  "GOOGLE_APPLICATION_CREDENTIALS",
  "GOOGLE_CLOUD_PROJECT",
  "MIGRATION_BACKUP_EVIDENCE_ID",
  "MIGRATION_RESTORE_EVIDENCE_ID",
  "MIGRATION_WRITE_FREEZE_ID",
  "NEXT_PUBLIC_SUPABASE_ANON_KEY",
  "NEXT_PUBLIC_SUPABASE_SECRET_KEY",
  "NEXT_PUBLIC_SUPABASE_SERVICE_ROLE_KEY",
  "POSTGRES_URL",
  "POSTGRES_URL_NON_POOLING",
  "POSTGRES_PRISMA_URL",
  "SUPABASE_ACCESS_TOKEN",
  "SUPABASE_ANON_KEY",
  "SUPABASE_DATABASE_URL",
  "SUPABASE_DB_PASSWORD",
  "SUPABASE_PUBLISHABLE_KEY",
  "SUPABASE_SECRET_KEY",
  "SUPABASE_SERVICE_ROLE_KEY",
  "SUPABASE_URL",
  "VERCEL_ENV",
  "VERCEL_TOKEN",
]);

export class TestTargetConfigError extends Error {
  constructor(errors) {
    super(`TEST target configuration rejected:\n${errors.join("\n")}`);
    this.name = "TestTargetConfigError";
    this.errors = Object.freeze([...errors]);
  }
}

function hasValue(value) {
  return typeof value === "string" && value.length > 0;
}

function requiredExactValue(env, key, expected, errors) {
  if (!hasValue(env[key])) errors.push(`${key} is required`);
  else if (env[key] !== expected) errors.push(`${key} does not match TEST`);
}

function forbiddenEnvironmentReason(key) {
  if (FORBIDDEN_EXACT_ENV_KEYS.has(key)) return "is forbidden";
  if (/^GIOIA_PRODUCTION_/i.test(key)) return "is Production-only";
  if (/^VERCEL(?:_|$)/i.test(key)) return "is a Vercel setting";
  if (/^(NEXT_PUBLIC_)?FIREBASE/i.test(key) || /^FIRESTORE/i.test(key)) {
    return "is a Firebase setting";
  }
  if (/^RESEND_/i.test(key)) return "is a Resend setting";
  if (/^POSTGRES_/i.test(key)) return "is an application database setting";
  if (/^PG[A-Z0-9_]*$/i.test(key)) {
    return "is a libpq database setting";
  }
  if (
    (/^SUPABASE_/i.test(key) || /^NEXT_PUBLIC_SUPABASE_/i.test(key)) &&
    !ALLOWED_SUPABASE_ENV_KEYS.has(key)
  ) {
    return "is an unexpected Supabase setting";
  }
  return null;
}

function validateForbiddenEnvironment(env, errors) {
  for (const key of Object.keys(env)) {
    const reason = forbiddenEnvironmentReason(key);
    if (reason) errors.push(`${key} ${reason} in the TEST operator`);
  }

  if (
    Object.entries(env).some(
      ([key, value]) => key.startsWith("DOTENV_CONFIG_") && hasValue(value),
    )
  ) {
    errors.push("dotenv loader settings are forbidden in the TEST operator");
  }
  if (/dotenv|--env-file/i.test(env.NODE_OPTIONS ?? "")) {
    errors.push("NODE_OPTIONS must not load dotenv files");
  }
}

function isDotenvName(name) {
  const normalizedName = name.toLowerCase();
  if (normalizedName === ".env") return true;
  if (!normalizedName.startsWith(".env.")) return false;
  return !/\.(?:example|sample|template)$/.test(normalizedName);
}

function validateNoDotenvFiles(rootDirectory, execArgv, errors) {
  try {
    if (
      readdirSync(rootDirectory, { withFileTypes: true }).some((entry) =>
        isDotenvName(entry.name),
      )
    ) {
      errors.push("dotenv files are forbidden in the TEST operator workspace");
    }
  } catch {
    errors.push("TEST operator workspace could not be inspected");
  }

  if (execArgv.some((argument) => /dotenv|--env-file/i.test(argument))) {
    errors.push("Node dotenv loading is forbidden in the TEST operator");
  }
}

function parseApiUrl(value, errors) {
  if (!hasValue(value)) {
    errors.push("NEXT_PUBLIC_SUPABASE_URL is required");
    return null;
  }
  try {
    const url = new URL(value);
    if (
      url.href !== `${TEST_TARGET_API_URL}/` ||
      url.username ||
      url.password
    ) {
      errors.push("NEXT_PUBLIC_SUPABASE_URL does not match the exact TEST API");
      return null;
    }
    return url;
  } catch {
    errors.push("NEXT_PUBLIC_SUPABASE_URL is not a valid URL");
    return null;
  }
}

function parseOperatorDatabaseUrl(value, errors) {
  if (!hasValue(value)) {
    errors.push("GIOIA_TEST_OPERATOR_DATABASE_URL is required");
    return null;
  }

  try {
    const url = new URL(value);
    const validQuery =
      url.searchParams.size === 1 &&
      url.searchParams.get("sslmode") === "verify-full";
    if (
      url.protocol !== "postgresql:" ||
      decodeURIComponent(url.username) !== OPERATOR_USERNAME ||
      !url.password ||
      !POOLER_HOST_PATTERN.test(url.hostname) ||
      url.port !== "5432" ||
      url.pathname !== "/postgres" ||
      url.hash ||
      !validQuery
    ) {
      errors.push(
        "GIOIA_TEST_OPERATOR_DATABASE_URL does not match the exact TEST session pooler",
      );
      return null;
    }
    return url;
  } catch {
    errors.push("GIOIA_TEST_OPERATOR_DATABASE_URL is not a valid URL");
    return null;
  }
}

function runtimeDatabaseUrl(operatorWorkerUrl, password) {
  if (
    typeof password !== "string" ||
    password.trim() !== password ||
    password.includes("\0") ||
    Buffer.byteLength(password, "utf8") < 32 ||
    Buffer.byteLength(password, "utf8") > 256
  ) {
    throw new TestTargetConfigError([
      "in-memory app_runtime password must contain 32 to 256 bytes",
    ]);
  }
  const url = new URL(operatorWorkerUrl);
  url.username = RUNTIME_USERNAME;
  url.password = password;
  return url.href;
}

function safeConfig(publishableKey, runId, apiUrl, operatorUrl) {
  const operatorSessionUrl = operatorUrl.href;
  const operatorWorker = new URL(operatorUrl);
  operatorWorker.port = "6543";
  const operatorWorkerUrl = operatorWorker.href;
  const config = {
    appEnv: "operator",
    environment: "test",
    projectRef: TEST_TARGET_REF,
    runId,
    apiUrl: apiUrl.href,
    poolerHost: operatorUrl.hostname,
    poolerRegion: TEST_TARGET_REGION,
    operatorSessionPort: 5432,
    operatorWorkerPort: 6543,
    sslmode: "verify-full",
  };

  Object.defineProperties(config, {
    deriveAppRuntimeDatabaseUrl: {
      value: (password) => runtimeDatabaseUrl(operatorWorkerUrl, password),
    },
    getOperatorSessionDatabaseUrl: { value: () => operatorSessionUrl },
    getOperatorWorkerDatabaseUrl: { value: () => operatorWorkerUrl },
    getPublishableKey: { value: () => publishableKey },
  });
  return Object.freeze(config);
}

export function parseTestTargetConfig(
  env,
  { rootDirectory = process.cwd(), execArgv = process.execArgv } = {},
) {
  const errors = [];
  requiredExactValue(env, "APP_ENV", "operator", errors);
  requiredExactValue(env, "SUPABASE_PROJECT_REF", TEST_TARGET_REF, errors);
  validateForbiddenEnvironment(env, errors);
  validateNoDotenvFiles(rootDirectory, execArgv, errors);

  const runId = env.GIOIA_TEST_RUN_ID;
  if (!UUID_PATTERN.test(runId ?? "")) {
    errors.push("GIOIA_TEST_RUN_ID must be a UUID");
  }
  if (
    !PUBLISHABLE_KEY_PATTERN.test(
      env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ?? "",
    )
  ) {
    errors.push(
      "NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY must be a modern publishable key",
    );
  }
  const apiUrl = parseApiUrl(env.NEXT_PUBLIC_SUPABASE_URL, errors);
  const operatorUrl = parseOperatorDatabaseUrl(
    env.GIOIA_TEST_OPERATOR_DATABASE_URL,
    errors,
  );

  if (errors.length > 0) throw new TestTargetConfigError(errors);
  return safeConfig(
    env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY,
    runId,
    apiUrl,
    operatorUrl,
  );
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  try {
    const config = parseTestTargetConfig(process.env);
    process.stdout.write(`${JSON.stringify(config)}\n`);
  } catch (error) {
    process.stderr.write(
      `${error instanceof TestTargetConfigError ? error.message : "TEST target configuration failed"}\n`,
    );
    process.exitCode = 1;
  }
}

import { X509Certificate } from "node:crypto";
import {
  closeSync,
  constants,
  fstatSync,
  openSync,
  readFileSync,
  readdirSync,
  realpathSync,
} from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  PROTECTED_OPERATOR_ENV_KEYS,
  isProtectedOperatorEnvironmentKey,
} from "../config/operatorEnvironmentPolicy.mjs";

export const TEST_TARGET_REF = "lxvsspniipcotimbsfqm";
export const TEST_TARGET_API_URL = `https://${TEST_TARGET_REF}.supabase.co`;
export const TEST_TARGET_REGION = "eu-central-2";
export const TEST_TARGET_CA_RELATIVE_PATH =
  "config/certificates/supabase-prod-ca-2021.crt";

const PUBLISHABLE_KEY_PATTERN = /^sb_publishable_[A-Za-z0-9_-]{20,}$/;
const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const POOLER_HOST_PATTERN = /^aws-[0-9]+-eu-central-2\.pooler\.supabase\.com$/;
const OPERATOR_USERNAME = `postgres.${TEST_TARGET_REF}`;
const RUNTIME_USERNAME = `app_runtime.${TEST_TARGET_REF}`;
const TEST_TARGET_CA_FINGERPRINT =
  "80:70:25:AD:50:D4:ED:21:9D:2C:9C:7D:29:9C:00:4F:82:4E:B0:0C:F7:F6:5A:FE:F6:07:D0:7B:72:E6:CA:FA";
const ALLOWED_SUPABASE_ENV_KEYS = new Set([
  "NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY",
  "NEXT_PUBLIC_SUPABASE_URL",
  "SUPABASE_PROJECT_REF",
]);
const ALLOWED_OPERATOR_ENV_KEYS = new Set([
  ...ALLOWED_SUPABASE_ENV_KEYS,
  "GIOIA_TEST_OPERATOR_DATABASE_URL",
  "GIOIA_TEST_PREVIEW_DATABASE_URL",
]);
const FORBIDDEN_EXACT_ENV_KEYS = new Set([
  ...PROTECTED_OPERATOR_ENV_KEYS.filter(
    (key) => !ALLOWED_OPERATOR_ENV_KEYS.has(key),
  ),
  "EMAIL_TRANSPORT",
  "GIOIA_PRODUCTION_APPROVAL_ID",
  "MIGRATION_BACKUP_EVIDENCE_ID",
  "MIGRATION_RESTORE_EVIDENCE_ID",
  "MIGRATION_WRITE_FREEZE_ID",
  "NODE_EXTRA_CA_CERTS",
  "NODE_TLS_REJECT_UNAUTHORIZED",
  "OPENSSL_CONF",
  "SSL_CERT_DIR",
  "SSL_CERT_FILE",
  "VERCEL_ENV",
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
  if (isProtectedOperatorEnvironmentKey(key, ALLOWED_OPERATOR_ENV_KEYS)) {
    return "is a protected provider or database setting";
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

function loadPinnedCertificate(rootDirectory, errors) {
  let descriptor;
  try {
    const expectedPath = path.resolve(
      realpathSync(rootDirectory),
      TEST_TARGET_CA_RELATIVE_PATH,
    );
    descriptor = openSync(
      expectedPath,
      constants.O_RDONLY | constants.O_NOFOLLOW,
    );
    const stat = fstatSync(descriptor);
    if (!stat.isFile() || stat.size === 0 || stat.size > 16 * 1024) {
      throw new Error();
    }
    if ((stat.mode & 0o022) !== 0) {
      throw new Error();
    }
    const source = readFileSync(descriptor, "utf8");
    const beginCount = source.split("-----BEGIN CERTIFICATE-----").length - 1;
    const endCount = source.split("-----END CERTIFICATE-----").length - 1;
    if (beginCount !== 1 || endCount !== 1) throw new Error();
    const certificate = new X509Certificate(source);
    if (
      !certificate.ca ||
      source !== certificate.toString() ||
      certificate.fingerprint256 !== TEST_TARGET_CA_FINGERPRINT ||
      Date.parse(certificate.validFrom) > Date.now() ||
      Date.parse(certificate.validTo) <= Date.now()
    ) {
      throw new Error();
    }
    return source;
  } catch {
    errors.push("Pinned TEST CA certificate is invalid");
    return null;
  } finally {
    if (descriptor !== undefined) closeSync(descriptor);
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

function parsePreviewDatabaseUrl(value, operatorUrl, errors) {
  if (!hasValue(value)) {
    errors.push("GIOIA_TEST_PREVIEW_DATABASE_URL is required");
    return null;
  }

  try {
    const url = new URL(value);
    const password = decodeURIComponent(url.password);
    const validQuery =
      url.searchParams.size === 1 &&
      url.searchParams.get("sslmode") === "verify-full";
    if (
      url.protocol !== "postgresql:" ||
      decodeURIComponent(url.username) !== RUNTIME_USERNAME ||
      password.trim() !== password ||
      password.includes("\0") ||
      Buffer.byteLength(password, "utf8") < 32 ||
      Buffer.byteLength(password, "utf8") > 256 ||
      !operatorUrl ||
      password === decodeURIComponent(operatorUrl.password) ||
      url.hostname !== operatorUrl.hostname ||
      url.port !== "6543" ||
      url.pathname !== "/postgres" ||
      url.hash ||
      !validQuery
    ) {
      errors.push(
        "GIOIA_TEST_PREVIEW_DATABASE_URL does not match the exact TEST Preview transaction pooler",
      );
      return null;
    }
    return url;
  } catch {
    errors.push("GIOIA_TEST_PREVIEW_DATABASE_URL is not a valid URL");
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

function safeConfig(
  publishableKey,
  runId,
  apiUrl,
  operatorUrl,
  previewUrl,
  certificatePem,
) {
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
    getPreviewRuntimeDatabaseUrl: { value: () => previewUrl.href },
    getPublishableKey: { value: () => publishableKey },
    getDatabaseCaCertificate: { value: () => certificatePem },
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
  const certificatePem = loadPinnedCertificate(rootDirectory, errors);

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
  const previewUrl = parsePreviewDatabaseUrl(
    env.GIOIA_TEST_PREVIEW_DATABASE_URL,
    operatorUrl,
    errors,
  );

  if (errors.length > 0 || certificatePem === null) {
    throw new TestTargetConfigError(errors);
  }
  return safeConfig(
    env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY,
    runId,
    apiUrl,
    operatorUrl,
    previewUrl,
    certificatePem,
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

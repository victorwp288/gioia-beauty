const APP_ENVIRONMENTS = new Set([
  "local",
  "test",
  "preview",
  "production",
  "operator",
]);

const REMOTE_FIREBASE_PROJECTS = [
  "gioia-beauty-b95e0",
  "clinic-418813",
  "gioia-beauty",
  "gioia-beauty-2d043",
];

export const GREENFIELD_SUPABASE_REF = "lxvsspniipcotimbsfqm";
export const PRODUCTION_SUPABASE_REF = null;
export const ISOLATED_FIREBASE_PROJECT_ID = "demo-gioia-beauty";
export const RUNTIME_LOGIN_ROLE = "app_runtime_login";

const FIREBASE_EMULATOR_HOSTS = {
  FIREBASE_AUTH_EMULATOR_HOST: "127.0.0.1:9099",
  FIRESTORE_EMULATOR_HOST: "127.0.0.1:8080",
  FIREBASE_STORAGE_EMULATOR_HOST: "127.0.0.1:9199",
};

const FIREBASE_TARGET_KEYS = [
  "NEXT_PUBLIC_FIREBASE_PROJECT_ID",
  "NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN",
  "NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET",
  "FIREBASE_ADMIN_PROJECT_ID",
  "FIREBASE_CONFIG",
  "GCLOUD_PROJECT",
  "GOOGLE_CLOUD_PROJECT",
];

const SUPABASE_URL_KEYS = [
  "NEXT_PUBLIC_SUPABASE_URL",
  "SUPABASE_URL",
  "SUPABASE_DATABASE_URL",
  "DATABASE_URL",
  "POSTGRES_URL",
];
const SUPABASE_DATABASE_URL_KEYS = [
  "SUPABASE_DATABASE_URL",
  "DATABASE_URL",
  "POSTGRES_URL",
];
const SUPABASE_API_URL_KEYS = ["NEXT_PUBLIC_SUPABASE_URL", "SUPABASE_URL"];

function hasValue(value) {
  return typeof value === "string" && value.trim() !== "";
}

function isLoopbackUrl(value) {
  if (!hasValue(value)) return true;

  try {
    const hostname = new URL(value).hostname;
    return (
      hostname === "localhost" || hostname === "127.0.0.1" || hostname === "::1"
    );
  } catch {
    return false;
  }
}

function referencesRemoteFirebase(env) {
  const containsProjectId = (value, projectId) => {
    const escaped = projectId.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    return new RegExp(`(^|[^a-z0-9-])${escaped}($|[^a-z0-9-])`, "i").test(
      value,
    );
  };

  return FIREBASE_TARGET_KEYS.flatMap((key) => {
    const value = env[key] || "";
    return REMOTE_FIREBASE_PROJECTS.filter((projectId) =>
      containsProjectId(value, projectId),
    ).map((projectId) => ({ key, projectId }));
  });
}

function isSupabaseUrlForRef(key, value, projectRef) {
  if (!hasValue(value)) return true;

  try {
    const url = new URL(value);
    const expectedApiHost = `${projectRef}.supabase.co`;

    if (key === "NEXT_PUBLIC_SUPABASE_URL" || key === "SUPABASE_URL") {
      return url.protocol === "https:" && url.hostname === expectedApiHost;
    }

    const username = decodeURIComponent(url.username);
    const isSharedPooler =
      url.hostname.endsWith(".pooler.supabase.com") &&
      url.port === "6543" &&
      username === `${RUNTIME_LOGIN_ROLE}.${projectRef}`;
    const searchParameters = [...url.searchParams.entries()];
    const usesPinnedTlsMode =
      searchParameters.length === 1 &&
      searchParameters[0][0] === "sslmode" &&
      searchParameters[0][1] === "verify-full" &&
      url.hash === "";

    return (
      ["postgres:", "postgresql:"].includes(url.protocol) &&
      url.pathname === "/postgres" &&
      hasValue(decodeURIComponent(url.password)) &&
      isSharedPooler &&
      usesPinnedTlsMode
    );
  } catch {
    return false;
  }
}

function validateSupabaseTarget(appEnv, env, errors, projectRef) {
  if (!projectRef) {
    errors.push(`No Supabase Production target is registered for ${appEnv}`);
    return;
  }

  if (env.SUPABASE_PROJECT_REF !== projectRef) {
    errors.push(`${appEnv} requires the exact registered Supabase project ref`);
  }

  if (!hasValue(env.NEXT_PUBLIC_SUPABASE_URL)) {
    errors.push(`${appEnv} requires NEXT_PUBLIC_SUPABASE_URL`);
  }
  if (!hasValue(env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY)) {
    errors.push(`${appEnv} requires NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`);
  } else if (
    !/^sb_publishable_[A-Za-z0-9_-]{20,}$/.test(
      env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY,
    )
  ) {
    errors.push("NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY has an invalid format");
  }
  if (!hasValue(env.SUPABASE_DATABASE_URL)) {
    errors.push(`${appEnv} requires SUPABASE_DATABASE_URL`);
  }

  for (const key of SUPABASE_API_URL_KEYS) {
    if (!isSupabaseUrlForRef(key, env[key], projectRef)) {
      errors.push(`${key} does not match the registered Supabase project ref`);
    }
  }

  for (const key of SUPABASE_DATABASE_URL_KEYS) {
    if (hasValue(env[key]) && !isSupabaseUrlForRef(key, env[key], projectRef)) {
      errors.push(
        `${key} must use the app_runtime_login credential carrier through the transaction pooler with sslmode=verify-full`,
      );
    }
  }
}

function validatePublicVariables(env, errors) {
  const forbiddenName =
    /(secret|service.?role|database|db.?password|private.?key|resend|access.?token)/i;

  for (const [key, value] of Object.entries(env)) {
    if (
      key.startsWith("NEXT_PUBLIC_") &&
      hasValue(value) &&
      forbiddenName.test(key)
    ) {
      errors.push(`${key} must never be exposed to the browser`);
    }
  }
}

function validateObservability(env, errors) {
  if (
    Object.hasOwn(env, "OBSERVABILITY_TRANSPORT") &&
    env.OBSERVABILITY_TRANSPORT !== "console"
  ) {
    errors.push("OBSERVABILITY_TRANSPORT must be console when configured");
  }

  for (const [key, value] of Object.entries(env)) {
    if (
      hasValue(value) &&
      (key.startsWith("SENTRY_") || key.startsWith("NEXT_PUBLIC_SENTRY_"))
    ) {
      errors.push(`${key} is forbidden until a Sentry target is registered`);
    }
  }
}

function validateBookingSecurity(appEnv, env, errors) {
  const secret = env.BOOKING_HMAC_SECRET;
  if (secret === undefined) {
    if (appEnv !== "local" && appEnv !== "test") {
      errors.push(`${appEnv} requires BOOKING_HMAC_SECRET`);
    }
    return;
  }

  if (
    secret.trim() !== secret ||
    secret.includes("\0") ||
    Buffer.byteLength(secret, "utf8") < 32
  ) {
    errors.push("BOOKING_HMAC_SECRET must contain at least 32 bytes");
  }
}

function validateOwnerSessionSecurity(appEnv, env, errors) {
  const secret = env.OWNER_SESSION_HMAC_SECRET;
  if (secret === undefined) {
    if (appEnv !== "local" && appEnv !== "test") {
      errors.push(`${appEnv} requires OWNER_SESSION_HMAC_SECRET`);
    }
    return;
  }

  if (
    secret.trim() !== secret ||
    secret.includes("\0") ||
    Buffer.byteLength(secret, "utf8") < 32
  ) {
    errors.push("OWNER_SESSION_HMAC_SECRET must contain at least 32 bytes");
  }
}

function validPaginationCursorKeyring(value) {
  if (
    typeof value !== "string" ||
    value.trim() !== value ||
    value.includes("\0") ||
    Buffer.byteLength(value, "utf8") > 4 * 1024
  ) {
    return false;
  }
  try {
    const parsed = JSON.parse(value);
    if (
      !parsed ||
      typeof parsed !== "object" ||
      Array.isArray(parsed) ||
      !/^[A-Za-z0-9_]{1,16}$/.test(parsed.activeKeyId) ||
      !Array.isArray(parsed.keys) ||
      parsed.keys.length < 1 ||
      parsed.keys.length > 3 ||
      Object.keys(parsed).sort().join(",") !== "activeKeyId,keys"
    ) {
      return false;
    }
    const identifiers = new Set();
    for (const key of parsed.keys) {
      if (
        !key ||
        typeof key !== "object" ||
        Array.isArray(key) ||
        Object.keys(key).sort().join(",") !== "id,secret" ||
        !/^[A-Za-z0-9_]{1,16}$/.test(key.id) ||
        !/^[A-Za-z0-9_-]{43}$/.test(key.secret) ||
        identifiers.has(key.id)
      ) {
        return false;
      }
      const secret = Buffer.from(key.secret, "base64url");
      if (secret.length !== 32 || secret.toString("base64url") !== key.secret) {
        return false;
      }
      identifiers.add(key.id);
    }
    return identifiers.has(parsed.activeKeyId);
  } catch {
    return false;
  }
}

function validatePaginationCursorSecurity(appEnv, env, errors) {
  const configuration = env.PAGINATION_CURSOR_KEYRING_JSON;
  if (configuration === undefined) {
    if (appEnv !== "local" && appEnv !== "test") {
      errors.push(`${appEnv} requires PAGINATION_CURSOR_KEYRING_JSON`);
    }
    return;
  }
  if (!validPaginationCursorKeyring(configuration)) {
    errors.push("PAGINATION_CURSOR_KEYRING_JSON is invalid");
  }
}

function validateLocalHumanChallenge(appEnv, env, errors) {
  const token = env.PUBLIC_HUMAN_CHALLENGE_TEST_TOKEN;
  if (token === undefined) return;
  if (appEnv !== "local" && appEnv !== "test") {
    errors.push(`PUBLIC_HUMAN_CHALLENGE_TEST_TOKEN is forbidden in ${appEnv}`);
    return;
  }
  if (!/^[A-Za-z0-9_-]{43}$/.test(token)) {
    errors.push("PUBLIC_HUMAN_CHALLENGE_TEST_TOKEN is invalid");
    return;
  }
  const bytes = Buffer.from(token, "base64url");
  if (bytes.length !== 32 || bytes.toString("base64url") !== token) {
    errors.push("PUBLIC_HUMAN_CHALLENGE_TEST_TOKEN is invalid");
  }
}

function validateProductionEmail(env, errors) {
  if (env.EMAIL_TRANSPORT !== "resend") {
    errors.push("Production requires EMAIL_TRANSPORT=resend");
  }
  if (!hasValue(env.RESEND_API_KEY)) {
    errors.push("Production requires RESEND_API_KEY");
  } else if (
    env.RESEND_API_KEY.trim() !== env.RESEND_API_KEY ||
    !/^re_[A-Za-z0-9_-]{16,508}$/.test(env.RESEND_API_KEY)
  ) {
    errors.push("RESEND_API_KEY has an invalid format");
  }
  if (env.EMAIL_WEBHOOK_ENABLED !== "true") {
    errors.push("Production requires EMAIL_WEBHOOK_ENABLED=true");
  }
  if (!hasValue(env.RESEND_WEBHOOK_SECRET)) {
    errors.push("Production requires RESEND_WEBHOOK_SECRET");
  } else if (
    env.RESEND_WEBHOOK_SECRET.trim() !== env.RESEND_WEBHOOK_SECRET ||
    !/^whsec_[A-Za-z0-9+/_=-]{32,256}$/.test(env.RESEND_WEBHOOK_SECRET)
  ) {
    errors.push("RESEND_WEBHOOK_SECRET has an invalid format");
  }
}

function validateVercelScope(appEnv, env, errors) {
  const expected = {
    local: new Set([undefined, "development"]),
    test: new Set([undefined]),
    preview: new Set(["preview"]),
    production: new Set(["production"]),
  }[appEnv];

  if (expected && !expected.has(env.VERCEL_ENV)) {
    errors.push(`APP_ENV=${appEnv} is incompatible with VERCEL_ENV`);
  }

  if (!hasValue(env.NEXT_PUBLIC_APP_ENV)) {
    errors.push("NEXT_PUBLIC_APP_ENV is required by the browser runtime");
  } else if (env.NEXT_PUBLIC_APP_ENV !== appEnv) {
    errors.push("NEXT_PUBLIC_APP_ENV must match APP_ENV");
  }
}

function validateIsolatedEnvironment(appEnv, env, errors) {
  for (const { key, projectId } of referencesRemoteFirebase(env)) {
    errors.push(
      `${key} references forbidden remote Firebase project ${projectId}`,
    );
  }

  if (
    hasValue(env.FIREBASE_EMULATOR_ENABLED) &&
    env.FIREBASE_EMULATOR_ENABLED !== "true"
  ) {
    errors.push("FIREBASE_EMULATOR_ENABLED must be true outside Production");
  }

  for (const [key, expected] of Object.entries(FIREBASE_EMULATOR_HOSTS)) {
    if (hasValue(env[key]) && env[key] !== expected) {
      errors.push(`${key} must be exactly ${expected} in ${appEnv}`);
    }
  }

  for (const key of [
    "NEXT_PUBLIC_FIREBASE_PROJECT_ID",
    "FIREBASE_ADMIN_PROJECT_ID",
    "GCLOUD_PROJECT",
    "GOOGLE_CLOUD_PROJECT",
  ]) {
    if (hasValue(env[key]) && env[key] !== ISOLATED_FIREBASE_PROJECT_ID) {
      errors.push(
        `${key} must use the isolated Firebase demo project in ${appEnv}`,
      );
    }
  }

  if (
    hasValue(env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN) &&
    !["127.0.0.1", "localhost"].includes(env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN)
  ) {
    errors.push(
      `NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN must be loopback in ${appEnv}`,
    );
  }

  if (
    hasValue(env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET) &&
    env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET !==
      `${ISOLATED_FIREBASE_PROJECT_ID}.appspot.com`
  ) {
    errors.push(
      `NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET must use the demo bucket in ${appEnv}`,
    );
  }

  if (hasValue(env.FIREBASE_CONFIG)) {
    errors.push(`FIREBASE_CONFIG is forbidden in ${appEnv}`);
  }

  const hasServerFirebaseProject = [
    env.FIREBASE_ADMIN_PROJECT_ID,
    env.NEXT_PUBLIC_FIREBASE_PROJECT_ID,
  ].some(hasValue);
  if (
    hasServerFirebaseProject &&
    env.FIREBASE_AUTH_EMULATOR_HOST !==
      FIREBASE_EMULATOR_HOSTS.FIREBASE_AUTH_EMULATOR_HOST
  ) {
    errors.push(
      "Firebase server auth requires the exact loopback Auth emulator",
    );
  }

  for (const key of [
    "GOOGLE_APPLICATION_CREDENTIALS",
    "FIREBASE_SERVICE_ACCOUNT",
    "FIREBASE_SERVICE_ACCOUNT_PATH",
    "RESEND_API_KEY",
    "RESEND_WEBHOOK_SECRET",
    "SUPABASE_ACCESS_TOKEN",
    "SUPABASE_DB_PASSWORD",
    "VERCEL_TOKEN",
  ]) {
    if (hasValue(env[key])) errors.push(`${key} is forbidden in ${appEnv}`);
  }

  if (env.EMAIL_TRANSPORT !== "fake") {
    errors.push(`EMAIL_TRANSPORT must be fake in ${appEnv}`);
  }
  if (env.EMAIL_WEBHOOK_ENABLED === "true") {
    errors.push(`EMAIL_WEBHOOK_ENABLED must not enable webhooks in ${appEnv}`);
  } else if (
    env.EMAIL_WEBHOOK_ENABLED !== undefined &&
    env.EMAIL_WEBHOOK_ENABLED !== "false"
  ) {
    errors.push("EMAIL_WEBHOOK_ENABLED must be true or false");
  }

  if (appEnv === "local" || appEnv === "test") {
    for (const key of SUPABASE_URL_KEYS) {
      if (!isLoopbackUrl(env[key])) {
        errors.push(`${key} must resolve to loopback in ${appEnv}`);
      }
    }

    if (hasValue(env.SUPABASE_PROJECT_REF)) {
      errors.push(`SUPABASE_PROJECT_REF is forbidden in ${appEnv}`);
    }
  }

  if (appEnv === "preview") {
    validateSupabaseTarget(appEnv, env, errors, GREENFIELD_SUPABASE_REF);
  }
}

export function validateEnvironment(env, { command = "application" } = {}) {
  const errors = [];
  const appEnv = env.APP_ENV;

  if (!APP_ENVIRONMENTS.has(appEnv)) {
    errors.push(
      "APP_ENV must be one of local, test, preview, production, or operator",
    );
    return { ok: false, appEnv: null, errors };
  }

  validatePublicVariables(env, errors);
  validateObservability(env, errors);
  validateBookingSecurity(appEnv, env, errors);
  validateOwnerSessionSecurity(appEnv, env, errors);
  validatePaginationCursorSecurity(appEnv, env, errors);
  validateLocalHumanChallenge(appEnv, env, errors);
  validateVercelScope(appEnv, env, errors);

  if (command === "test" && appEnv !== "test") {
    errors.push("The test command requires APP_ENV=test");
  }

  if (["local", "test", "preview"].includes(appEnv)) {
    validateIsolatedEnvironment(appEnv, env, errors);
  }

  if (appEnv === "production") {
    if (!hasValue(env.GIOIA_PRODUCTION_APPROVAL_ID)) {
      errors.push(
        "Production application commands require GIOIA_PRODUCTION_APPROVAL_ID",
      );
    }
    validateSupabaseTarget(appEnv, env, errors, PRODUCTION_SUPABASE_REF);

    validateProductionEmail(env, errors);

    for (const [key, value] of Object.entries(env)) {
      if (
        hasValue(value) &&
        (key.startsWith("FIREBASE") ||
          key.startsWith("NEXT_PUBLIC_FIREBASE") ||
          key.startsWith("FIRESTORE") ||
          key.endsWith("_EMULATOR_HOST") ||
          key === "GCLOUD_PROJECT" ||
          key === "GOOGLE_CLOUD_PROJECT" ||
          key === "GOOGLE_APPLICATION_CREDENTIALS")
      ) {
        errors.push(
          `${key} is forbidden in the Firebase-free Production application`,
        );
      }
    }
  }

  if (appEnv === "operator" && command === "application") {
    errors.push(
      "The protected operator environment cannot start the application",
    );
  }

  return { ok: errors.length === 0, appEnv, errors };
}

export function assertEnvironment(env, options) {
  const result = validateEnvironment(env, options);
  if (!result.ok) {
    throw new Error(
      `Environment validation failed:\n${result.errors.map((error) => `- ${error}`).join("\n")}`,
    );
  }
  return result;
}

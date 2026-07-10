import { GREENFIELD_TEST_OWNER } from "./test-target-fixture-sql.mjs";
import { TEST_TARGET_API_URL, TEST_TARGET_REF } from "./test-target-config.mjs";

const MAX_RESPONSE_BYTES = 16 * 1024;
const PUBLIC_KEY = /^sb_publishable_[A-Za-z0-9_-]{20,}$/u;
// Public synthetic denial input. It is never an owner credential.
const DENIED_SIGNUP_PASSWORD = "GioiaGreenfieldSignup9!Denied"; // gitleaks:allow

function failure() {
  return new Error("Greenfield TEST Auth configuration is unsafe");
}

function validate(config, fetchImpl, timeoutMs) {
  if (
    config?.environment !== "test" ||
    config.projectRef !== TEST_TARGET_REF ||
    config.apiUrl !== `${TEST_TARGET_API_URL}/` ||
    typeof config.getPublishableKey !== "function" ||
    typeof fetchImpl !== "function" ||
    !Number.isInteger(timeoutMs) ||
    timeoutMs < 1 ||
    timeoutMs > 10_000
  ) {
    throw failure();
  }
  const key = config.getPublishableKey();
  if (!PUBLIC_KEY.test(key ?? "")) throw failure();
  return key;
}

async function boundedJson(response) {
  const declared = Number(response.headers.get("content-length"));
  if (Number.isFinite(declared) && declared > MAX_RESPONSE_BYTES) {
    throw failure();
  }
  if (!response.body) throw failure();
  const reader = response.body.getReader();
  const chunks = [];
  let total = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > MAX_RESPONSE_BYTES) {
        await reader.cancel().catch(() => {});
        throw failure();
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  try {
    const source = Buffer.concat(chunks).toString("utf8");
    const value = JSON.parse(source);
    if (!value || typeof value !== "object" || Array.isArray(value)) {
      throw failure();
    }
    return value;
  } catch {
    throw failure();
  }
}

async function request(config, key, path, options, fetchImpl, timeoutMs) {
  try {
    const response = await fetchImpl(new URL(path, config.apiUrl), {
      cache: "no-store",
      credentials: "omit",
      redirect: "error",
      referrerPolicy: "no-referrer",
      signal: AbortSignal.timeout(timeoutMs),
      ...options,
      headers: new Headers({
        apikey: key,
        ...(options.headers ?? {}),
      }),
    });
    return { response, body: await boundedJson(response) };
  } catch {
    throw failure();
  }
}

export async function verifyTestTargetAuthConfiguration(
  config,
  { fetchImpl = fetch, timeoutMs = 5_000 } = {},
) {
  const key = validate(config, fetchImpl, timeoutMs);
  const settings = await request(
    config,
    key,
    "/auth/v1/settings",
    { method: "GET" },
    fetchImpl,
    timeoutMs,
  );
  if (
    settings.response.status !== 200 ||
    settings.body.disable_signup !== true ||
    settings.body.external?.email !== true
  ) {
    throw failure();
  }

  const signup = await request(
    config,
    key,
    "/auth/v1/signup",
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        email: GREENFIELD_TEST_OWNER.email,
        password: DENIED_SIGNUP_PASSWORD,
      }),
    },
    fetchImpl,
    timeoutMs,
  );
  const code = signup.body.error_code ?? signup.body.code;
  if (signup.response.status !== 422 || code !== "signup_disabled") {
    throw failure();
  }
  return Object.freeze({
    disableSignup: true,
    emailProvider: true,
    signupDenied: true,
  });
}

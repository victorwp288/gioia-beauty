import { execFile } from "node:child_process";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { promisify } from "node:util";

import { LOCAL_SYNTHETIC_OWNER } from "./local-phase3-e2e-contract.mjs";
import { localSupabasePorts } from "./local-supabase-ports.mjs";

export { LOCAL_SYNTHETIC_OWNER };

const execFileAsync = promisify(execFile);
const LOCAL_HOSTS = new Set(["127.0.0.1", "localhost", "::1"]);
export const LOCAL_DISABLED_SIGNUP_PROBE = Object.freeze({
  email: "signup-disabled.local@gioia.test",
  password: "GioiaSignup1!NotSecret", // gitleaks:allow
});
const supabaseBinary = path.join(
  process.cwd(),
  "node_modules",
  ".bin",
  "supabase",
);

function requiredString(value, field) {
  if (
    typeof value !== "string" ||
    value.length < 16 ||
    value.length > 4096 ||
    /\s/u.test(value)
  ) {
    throw new Error(`Supabase status returned an invalid ${field}`);
  }
  return value;
}

export function parseLocalAuthStatus(
  status,
  expectedApiPort = localSupabasePorts({}).api,
) {
  if (status === null || typeof status !== "object" || Array.isArray(status)) {
    throw new Error("Supabase status must be an object");
  }

  const apiUrl = new URL(String(status.API_URL ?? ""));
  if (
    apiUrl.protocol !== "http:" ||
    !LOCAL_HOSTS.has(apiUrl.hostname) ||
    apiUrl.port !== expectedApiPort ||
    !["", "/"].includes(apiUrl.pathname) ||
    apiUrl.search !== "" ||
    apiUrl.hash !== ""
  ) {
    throw new Error("Supabase status did not return the safe local Auth URL");
  }

  const publishableKey = requiredString(
    status.PUBLISHABLE_KEY ?? status.ANON_KEY,
    "local publishable key",
  );
  return { apiUrl, publishableKey };
}

async function responseObject(response, operation) {
  const payload = await response.json().catch(() => null);
  if (
    payload === null ||
    typeof payload !== "object" ||
    Array.isArray(payload)
  ) {
    throw new Error(
      `Local Auth ${operation} returned a non-object response with status ${response.status}`,
    );
  }
  return payload;
}

async function responseJson(response, operation) {
  const payload = await responseObject(response, operation);
  if (!response.ok) {
    const candidate = payload?.error_code ?? payload?.code;
    const safeCode =
      typeof candidate === "string" && /^[a-z0-9_]{1,64}$/u.test(candidate)
        ? ` (${candidate})`
        : "";
    throw new Error(
      `Local Auth ${operation} failed with status ${response.status}${safeCode}`,
    );
  }
  return payload;
}

async function verifyPublicSignupDisabled(apiUrl, publishableKey) {
  const headers = { apikey: publishableKey };
  const settingsResponse = await fetch(new URL("/auth/v1/settings", apiUrl), {
    headers,
    signal: AbortSignal.timeout(10_000),
  });
  const settings = await responseJson(settingsResponse, "settings lookup");
  if (settings.disable_signup !== true || settings.external?.email !== true) {
    throw new Error("Local Auth signup/provider settings are unsafe");
  }

  const signupResponse = await fetch(new URL("/auth/v1/signup", apiUrl), {
    method: "POST",
    headers: { ...headers, "Content-Type": "application/json" },
    body: JSON.stringify(LOCAL_DISABLED_SIGNUP_PROBE),
    signal: AbortSignal.timeout(10_000),
  });
  const signup = await responseObject(signupResponse, "disabled signup");
  const code = signup.error_code ?? signup.code;
  if (signupResponse.status !== 422 || code !== "signup_disabled") {
    const safeCode =
      typeof code === "string" && /^[a-z0-9_]{1,64}$/u.test(code)
        ? ` (${code})`
        : "";
    throw new Error(
      `Local Auth accepted or misclassified disabled signup with status ${signupResponse.status}${safeCode}`,
    );
  }
}

async function getLocalAuthStatus(environment = process.env) {
  const { stdout } = await execFileAsync(
    supabaseBinary,
    ["status", "-o", "json"],
    {
      env: { ...environment, SUPABASE_TELEMETRY_DISABLED: "1" },
      maxBuffer: 1024 * 1024,
      timeout: 30_000,
    },
  );
  return parseLocalAuthStatus(
    JSON.parse(stdout),
    localSupabasePorts(environment).api,
  );
}

async function verifySeededOwnerLogin() {
  const { apiUrl, publishableKey } = await getLocalAuthStatus();
  await verifyPublicSignupDisabled(apiUrl, publishableKey);
  const tokenUrl = new URL("/auth/v1/token?grant_type=password", apiUrl);
  const signInResponse = await fetch(tokenUrl, {
    method: "POST",
    headers: {
      apikey: publishableKey,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      email: LOCAL_SYNTHETIC_OWNER.email,
      password: LOCAL_SYNTHETIC_OWNER.password,
    }),
    signal: AbortSignal.timeout(10_000),
  });
  const session = await responseJson(signInResponse, "password sign-in");
  const accessToken = requiredString(session.access_token, "access token");
  if (
    session.user?.id !== LOCAL_SYNTHETIC_OWNER.id ||
    session.user?.email !== LOCAL_SYNTHETIC_OWNER.email
  ) {
    throw new Error(
      "Local Auth sign-in returned the wrong synthetic principal",
    );
  }

  const userResponse = await fetch(new URL("/auth/v1/user", apiUrl), {
    headers: {
      apikey: publishableKey,
      Authorization: `Bearer ${accessToken}`,
    },
    signal: AbortSignal.timeout(10_000),
  });
  const user = await responseJson(userResponse, "user verification");
  if (
    user.id !== LOCAL_SYNTHETIC_OWNER.id ||
    user.email !== LOCAL_SYNTHETIC_OWNER.email
  ) {
    throw new Error(
      "Local Auth verification returned the wrong synthetic principal",
    );
  }

  const logoutResponse = await fetch(
    new URL("/auth/v1/logout?scope=global", apiUrl),
    {
      method: "POST",
      headers: {
        apikey: publishableKey,
        Authorization: `Bearer ${accessToken}`,
      },
      signal: AbortSignal.timeout(10_000),
    },
  );
  if (!logoutResponse.ok) {
    throw new Error(
      `Local Auth logout failed with status ${logoutResponse.status}`,
    );
  }

  process.stdout.write(
    "Synthetic local signup denial and owner password login passed.\n",
  );
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  verifySeededOwnerLogin().catch((error) => {
    process.stderr.write(
      `Synthetic local Auth seed test failed: ${error instanceof Error ? error.message : String(error)}\n`,
    );
    process.exitCode = 1;
  });
}

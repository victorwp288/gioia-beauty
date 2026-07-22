import { spawn } from "node:child_process";
import path from "node:path";

import { assertEnvironment } from "../config/environment.mjs";
import { LOCAL_PHASE3_E2E_BOOKING_HMAC_SECRET } from "./local-phase3-e2e-contract.mjs";
import { getLocalRouteStatus } from "./local-owner-auth-harness.mjs";

const LOOPBACK_HOSTS = new Set(["127.0.0.1", "localhost", "::1"]);
const FORBIDDEN_INHERITED_KEYS = [
  "GIOIA_PRODUCTION_APPROVAL_ID",
  "GIOIA_PRODUCTION_OPERATOR_DATABASE_URL",
  "GIOIA_TEST_OPERATOR_DATABASE_URL",
  "GIOIA_TEST_RUNTIME_DATABASE_URL",
  "RESEND_API_KEY",
  "RESEND_WEBHOOK_SECRET",
  "SUPABASE_ACCESS_TOKEN",
  "SUPABASE_DB_PASSWORD",
  "SUPABASE_PROJECT_REF",
  "VERCEL_TOKEN",
];
const LOCAL_OWNER_SESSION_SECRET =
  "phase3-local-e2e-owner-session-secret-00000000000";
const LOCAL_HUMAN_CHALLENGE_TOKEN = "A".repeat(43);

function configuredBaseUrl(value) {
  let url;
  try {
    url = new URL(value ?? "http://127.0.0.1:3100");
  } catch {
    throw new Error("Phase 3 E2E requires a valid loopback base URL");
  }

  if (
    url.protocol !== "http:" ||
    !LOOPBACK_HOSTS.has(url.hostname) ||
    !url.port ||
    url.username ||
    url.password ||
    !["", "/"].includes(url.pathname) ||
    url.search ||
    url.hash
  ) {
    throw new Error("Phase 3 E2E requires an exact loopback HTTP base URL");
  }
  return url;
}

function rejectProtectedInheritedEnvironment(environment) {
  const present = FORBIDDEN_INHERITED_KEYS.filter(
    (key) => typeof environment[key] === "string" && environment[key] !== "",
  );
  if (present.length > 0) {
    throw new Error(
      `Phase 3 E2E forbids protected inherited environment keys: ${present.join(", ")}`,
    );
  }
}

function childEnvironment(status) {
  const environment = {
    ...process.env,
    APP_ENV: "test",
    BOOKING_HMAC_SECRET: LOCAL_PHASE3_E2E_BOOKING_HMAC_SECRET,
    EMAIL_TRANSPORT: "fake",
    EMAIL_WEBHOOK_ENABLED: "false",
    NEXT_PUBLIC_APP_ENV: "test",
    NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: status.publishableKey,
    NEXT_PUBLIC_SUPABASE_URL: status.apiUrl.href,
    NEXT_TELEMETRY_DISABLED: "1",
    OWNER_SESSION_HMAC_SECRET: LOCAL_OWNER_SESSION_SECRET,
    PUBLIC_HUMAN_CHALLENGE_TEST_TOKEN: LOCAL_HUMAN_CHALLENGE_TOKEN,
    SUPABASE_DATABASE_URL: status.databaseUrl,
    SUPABASE_TELEMETRY_DISABLED: "1",
  };
  assertEnvironment(environment, { command: "application" });
  return environment;
}

async function main() {
  rejectProtectedInheritedEnvironment(process.env);
  const baseUrl = configuredBaseUrl(process.env.PLAYWRIGHT_BASE_URL);
  const status = await getLocalRouteStatus();
  const nextBinary = path.join(process.cwd(), "node_modules", ".bin", "next");
  const child = spawn(
    nextBinary,
    ["dev", "--hostname", baseUrl.hostname, "--port", baseUrl.port],
    {
      cwd: process.cwd(),
      env: childEnvironment(status),
      stdio: "inherit",
    },
  );

  const forward = (signal) => {
    if (child.exitCode === null) child.kill(signal);
  };
  process.once("SIGINT", () => forward("SIGINT"));
  process.once("SIGTERM", () => forward("SIGTERM"));

  const exit = await new Promise((resolve, reject) => {
    child.once("error", reject);
    child.once("exit", (code, signal) => resolve({ code, signal }));
  });
  if (exit.signal) {
    process.kill(process.pid, exit.signal);
    return;
  }
  process.exitCode = exit.code ?? 1;
}

main().catch((error) => {
  process.stderr.write(
    `Local Phase 3 E2E server failed: ${error instanceof Error ? error.message : String(error)}\n`,
  );
  process.exitCode = 1;
});

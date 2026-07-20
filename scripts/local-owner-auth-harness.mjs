import { execFile, spawn } from "node:child_process";
import net from "node:net";
import path from "node:path";
import { promisify } from "node:util";

import { localSupabasePorts } from "./local-supabase-ports.mjs";

export { CookieJar } from "./owner-auth-route-scenario.mjs";

const execFileAsync = promisify(execFile);
const LOCAL_HOSTS = new Set(["127.0.0.1", "localhost", "::1"]);
const supabaseBinary = path.join(
  process.cwd(),
  "node_modules",
  ".bin",
  "supabase",
);
const nextBinary = path.join(process.cwd(), "node_modules", ".bin", "next");

function localUrl(value, port, label) {
  const url = new URL(String(value ?? ""));
  if (
    url.protocol !== "http:" ||
    !LOCAL_HOSTS.has(url.hostname) ||
    url.port !== port ||
    !["", "/"].includes(url.pathname) ||
    url.search ||
    url.hash
  ) {
    throw new Error(`Supabase status returned an unsafe ${label}`);
  }
  return url;
}

function localDatabaseUrl(value, expectedPort) {
  const url = new URL(String(value ?? ""));
  if (
    !["postgres:", "postgresql:"].includes(url.protocol) ||
    !LOCAL_HOSTS.has(url.hostname) ||
    url.port !== expectedPort ||
    url.username !== "postgres" ||
    url.pathname !== "/postgres"
  ) {
    throw new Error("Supabase status returned an unsafe local database URL");
  }
  return url.href;
}

function publicKey(value) {
  if (
    typeof value !== "string" ||
    value.length < 16 ||
    value.length > 4_096 ||
    /\s/u.test(value)
  ) {
    throw new Error("Supabase status returned an invalid publishable key");
  }
  return value;
}

export function parseLocalRouteStatus(
  status,
  expectedPorts = localSupabasePorts({}),
) {
  if (!status || typeof status !== "object" || Array.isArray(status)) {
    throw new Error("Supabase status must be an object");
  }
  return {
    apiUrl: localUrl(status.API_URL, expectedPorts.api, "local API URL"),
    databaseUrl: localDatabaseUrl(status.DB_URL, expectedPorts.database),
    publishableKey: publicKey(status.PUBLISHABLE_KEY ?? status.ANON_KEY),
  };
}

export async function getLocalRouteStatus(environment = process.env) {
  const { stdout } = await execFileAsync(
    supabaseBinary,
    ["status", "-o", "json"],
    {
      env: { ...environment, SUPABASE_TELEMETRY_DISABLED: "1" },
      maxBuffer: 1024 * 1024,
      timeout: 30_000,
    },
  );
  return parseLocalRouteStatus(
    JSON.parse(stdout),
    localSupabasePorts(environment),
  );
}

async function availablePort() {
  return await new Promise((resolve, reject) => {
    const server = net.createServer();
    server.unref();
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      server.close((error) => {
        if (error) reject(error);
        else if (typeof address === "object" && address) resolve(address.port);
        else reject(new Error("Could not allocate a loopback port"));
      });
    });
  });
}

async function waitForServer(baseUrl, child) {
  const deadline = Date.now() + 90_000;
  while (Date.now() < deadline) {
    if (child.exitCode !== null)
      throw new Error("Next auth server exited early");
    try {
      await fetch(new URL("/api/auth/session", baseUrl), {
        signal: AbortSignal.timeout(2_000),
      });
      return;
    } catch {
      await new Promise((resolve) => setTimeout(resolve, 250));
    }
  }
  throw new Error("Next auth server did not become ready");
}

async function stopServer(child) {
  if (child.exitCode !== null) return;
  child.kill("SIGTERM");
  await Promise.race([
    new Promise((resolve) => child.once("exit", resolve)),
    new Promise((resolve) => setTimeout(resolve, 5_000)),
  ]);
  if (child.exitCode === null) child.kill("SIGKILL");
}

export async function withLocalOwnerAuthServer(status, callback) {
  const port = await availablePort();
  const baseUrl = new URL(`http://127.0.0.1:${port}`);
  const child = spawn(
    nextBinary,
    ["dev", "--hostname", "127.0.0.1", "--port", String(port)],
    {
      cwd: process.cwd(),
      env: {
        ...process.env,
        APP_ENV: "test",
        EMAIL_TRANSPORT: "fake",
        NEXT_PUBLIC_APP_ENV: "test",
        NEXT_PUBLIC_SUPABASE_URL: status.apiUrl.href,
        NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: status.publishableKey,
        SUPABASE_DATABASE_URL: status.databaseUrl,
        OWNER_SESSION_HMAC_SECRET:
          "local-route-test-owner-session-secret-000000000000",
        NEXT_TELEMETRY_DISABLED: "1",
      },
      stdio: "ignore",
    },
  );
  try {
    await waitForServer(baseUrl, child);
    return await callback(baseUrl);
  } finally {
    await stopServer(child);
  }
}

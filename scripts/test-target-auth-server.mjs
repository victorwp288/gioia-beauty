import { spawn } from "node:child_process";
import { randomBytes } from "node:crypto";
import net from "node:net";
import path from "node:path";

const nextBinary = path.join(process.cwd(), "node_modules", ".bin", "next");

function availablePort() {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.unref();
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      server.close((error) => {
        if (error) reject(error);
        else if (typeof address === "object" && address) resolve(address.port);
        else reject(new Error("Could not allocate a TEST route port"));
      });
    });
  });
}

function hasExited(child) {
  return child.exitCode !== null || child.signalCode !== null;
}

async function waitForServer(baseUrl, child) {
  const deadline = Date.now() + 90_000;
  while (Date.now() < deadline) {
    if (hasExited(child)) {
      throw new Error("Greenfield TEST Next server exited early");
    }
    try {
      await fetch(new URL("/api/auth/session", baseUrl), {
        signal: AbortSignal.timeout(2_000),
      });
      return;
    } catch {
      await new Promise((resolve) => setTimeout(resolve, 250));
    }
  }
  throw new Error("Greenfield TEST Next server did not become ready");
}

function signalProcessTree(child, signal) {
  if (Number.isSafeInteger(child.pid) && child.pid > 0) {
    try {
      process.kill(-child.pid, signal);
      return;
    } catch (error) {
      if (error?.code !== "ESRCH") throw error;
    }
  }
  child.kill(signal);
}

function waitForExit(child, timeout) {
  if (hasExited(child)) return Promise.resolve(true);
  return new Promise((resolve) => {
    const timer = setTimeout(() => {
      child.off("exit", onExit);
      resolve(false);
    }, timeout);
    const onExit = () => {
      clearTimeout(timer);
      resolve(true);
    };
    child.once("exit", onExit);
  });
}

export async function stopGreenfieldOwnerAuthServer(
  child,
  { signalImpl = signalProcessTree, graceTimeout = 5_000 } = {},
) {
  if (hasExited(child)) return;
  signalImpl(child, "SIGTERM");
  if (await waitForExit(child, graceTimeout)) return;
  signalImpl(child, "SIGKILL");
  if (!(await waitForExit(child, 5_000))) {
    throw new Error("Greenfield TEST Next process tree did not stop");
  }
}

export function greenfieldChildEnvironment(config, runtimeDatabaseUrl) {
  const ephemeralSecret = () => randomBytes(32).toString("base64url");
  return {
    APP_ENV: "preview",
    BOOKING_HMAC_SECRET: ephemeralSecret(),
    CI: "true",
    EMAIL_TRANSPORT: "fake",
    HOME: process.env.HOME,
    NEXT_PUBLIC_APP_ENV: "preview",
    NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: config.getPublishableKey(),
    NEXT_PUBLIC_SUPABASE_URL: config.apiUrl,
    NEXT_TELEMETRY_DISABLED: "1",
    OWNER_SESSION_HMAC_SECRET: ephemeralSecret(),
    PATH: process.env.PATH,
    SUPABASE_DATABASE_URL: runtimeDatabaseUrl,
    SUPABASE_PROJECT_REF: config.projectRef,
    TMPDIR: process.env.TMPDIR ?? "/tmp",
    VERCEL_ENV: "preview",
  };
}

export async function withGreenfieldOwnerAuthServer(
  config,
  runtimeDatabaseUrl,
  callback,
  { spawnImpl = spawn, portFactory = availablePort } = {},
) {
  const port = await portFactory();
  const baseUrl = new URL(`http://127.0.0.1:${port}`);
  const child = spawnImpl(
    nextBinary,
    ["dev", "--hostname", "127.0.0.1", "--port", String(port)],
    {
      cwd: process.cwd(),
      detached: true,
      env: greenfieldChildEnvironment(config, runtimeDatabaseUrl),
      stdio: "ignore",
    },
  );
  try {
    await waitForServer(baseUrl, child);
    return await callback(baseUrl);
  } finally {
    await stopGreenfieldOwnerAuthServer(child);
  }
}

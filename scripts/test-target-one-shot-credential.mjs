import { spawn } from "node:child_process";
import { readFileSync, realpathSync } from "node:fs";
import { fileURLToPath } from "node:url";

const PINNED_CA_PATH = fileURLToPath(
  new URL("../config/certificates/supabase-prod-ca-2021.crt", import.meta.url),
);
const PROBE_TIMEOUT_MS = 15_000;
const REAP_TIMEOUT_MS = 2_000;
const PSQL_17_PATHS = Object.freeze([
  /^\/opt\/homebrew\/Cellar\/postgresql@17\/[^/]+\/bin\/psql$/,
  /^\/usr\/lib\/postgresql\/17\/bin\/psql$/,
]);

function probeError(credentialLabel) {
  return new Error(`Greenfield TEST ${credentialLabel} could not authenticate`);
}

export function resolveProtectedPsqlPath(
  psqlPath,
  { platform = process.platform, realpathImpl = realpathSync } = {},
) {
  const candidate =
    psqlPath ??
    (platform === "darwin"
      ? "/opt/homebrew/bin/psql"
      : "/usr/lib/postgresql/17/bin/psql");
  const resolved = realpathImpl(candidate);
  if (!PSQL_17_PATHS.some((pattern) => pattern.test(resolved))) {
    throw new Error("Greenfield TEST psql binary is not allowlisted");
  }
  return resolved;
}

function exactProbeEnvironment(databaseUrl, caCertificate) {
  const url = new URL(databaseUrl);
  if (
    url.protocol !== "postgresql:" ||
    !url.hostname ||
    !url.port ||
    !url.username ||
    !url.password ||
    url.pathname !== "/postgres" ||
    url.searchParams.get("sslmode") !== "verify-full" ||
    readFileSync(PINNED_CA_PATH, "utf8") !== caCertificate ||
    typeof caCertificate !== "string"
  ) {
    throw new Error("Greenfield TEST one-shot credential probe is invalid");
  }
  return Object.freeze({
    LANG: "C",
    LC_ALL: "C",
    PGAPPNAME: "gioia_greenfield_credential_probe",
    PGCONNECT_TIMEOUT: "10",
    PGDATABASE: "postgres",
    PGHOST: url.hostname,
    PGPASSWORD: decodeURIComponent(url.password),
    PGPORT: url.port,
    PGSSLMODE: "verify-full",
    PGSSLROOTCERT: PINNED_CA_PATH,
    PGUSER: decodeURIComponent(url.username),
  });
}

export async function verifyOneShotRuntimeCredential({
  authenticateSql,
  authorizeSql,
  assumeSql,
  caCertificate,
  credentialLabel,
  databaseUrl,
  processFactory = spawn,
  psqlPath,
  psqlResolver = resolveProtectedPsqlPath,
  reapTimeoutMs = REAP_TIMEOUT_MS,
  timeoutMs = PROBE_TIMEOUT_MS,
}) {
  let environment;
  let executable;
  try {
    environment = exactProbeEnvironment(databaseUrl, caCertificate);
    executable = psqlResolver(psqlPath);
  } catch {
    throw probeError(credentialLabel);
  }
  const query = `begin read only;\n${authenticateSql};\n${assumeSql};\n${authorizeSql};\nrollback;`;

  try {
    await new Promise((resolve, reject) => {
      let settled = false;
      let stdout = "";
      let reapTimeout;
      let timeout;
      const child = processFactory(
        executable,
        [
          "--no-psqlrc",
          "--quiet",
          "--tuples-only",
          "--no-align",
          "--set=ON_ERROR_STOP=1",
          "--command",
          query,
        ],
        {
          env: environment,
          stdio: ["ignore", "pipe", "pipe"],
        },
      );
      const finish = (error) => {
        if (settled) return;
        settled = true;
        clearTimeout(timeout);
        clearTimeout(reapTimeout);
        if (error) reject(error);
        else resolve();
      };
      timeout = setTimeout(() => {
        try {
          child.kill("SIGKILL");
        } catch {
          // The generic failure below remains authoritative.
        }
        reapTimeout = setTimeout(() => {
          try {
            child.kill("SIGKILL");
          } catch {
            // The generic failure below remains authoritative.
          }
          finish(new Error("probe process was not reaped"));
        }, reapTimeoutMs);
      }, timeoutMs);

      child.stdout?.setEncoding("utf8");
      child.stdout?.on("data", (chunk) => {
        stdout = `${stdout}${chunk}`.slice(0, 64);
      });
      child.stderr?.resume();
      child.once("error", finish);
      child.once("close", (code, signal) => {
        const rows = stdout
          .split("\n")
          .map((row) => row.trim())
          .filter(Boolean);
        finish(
          code !== 0 || signal !== null || rows.join(",") !== "t,t"
            ? new Error("probe rejected")
            : null,
        );
      });
    });
  } catch {
    throw probeError(credentialLabel);
  }
}

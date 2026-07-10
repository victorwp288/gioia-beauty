import { execFile } from "node:child_process";
import { chmodSync, mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { remotePgTapFiles } from "./test-target-migrations.mjs";

export const TEST_TARGET_SUPABASE_CLI_VERSION = "2.109.1";

const TEST_TARGET_REF = "lxvsspniipcotimbsfqm";
const TEST_TARGET_POOLER = /^aws-[0-9]+-eu-central-2\.pooler\.supabase\.com$/u;
const MAX_BUFFER_BYTES = 16 * 1024 * 1024;
const COMMAND_TIMEOUT_MS = 10 * 60 * 1000;

export class TestTargetCliError extends Error {
  constructor(message, { stdout = "", stderr = "" } = {}) {
    super(message);
    this.name = "TestTargetCliError";
    this.stdout = stdout;
    this.stderr = stderr;
  }
}

function asText(value) {
  if (typeof value === "string") return value;
  if (Buffer.isBuffer(value)) return value.toString("utf8");
  return "";
}

function validateOperatorDatabaseUrl(value) {
  if (typeof value !== "string" || value.length === 0) {
    throw new TestTargetCliError("TEST operator database URL is required");
  }

  let url;
  try {
    url = new URL(value);
  } catch {
    throw new TestTargetCliError("TEST operator database URL is invalid");
  }

  if (
    url.protocol !== "postgresql:" ||
    decodeURIComponent(url.username) !== `postgres.${TEST_TARGET_REF}` ||
    !url.password ||
    !TEST_TARGET_POOLER.test(url.hostname) ||
    url.port !== "5432" ||
    url.pathname !== "/postgres" ||
    url.hash ||
    url.searchParams.size !== 1 ||
    url.searchParams.get("sslmode") !== "verify-full"
  ) {
    throw new TestTargetCliError(
      "Database URL is not the exact greenfield TEST session pooler",
    );
  }
  return url.href;
}

function secretValues(databaseUrl) {
  const values = new Set([databaseUrl]);
  const url = new URL(databaseUrl);
  for (const value of [url.password, decodeURIComponent(url.password)]) {
    if (value.length >= 8) values.add(value);
  }
  try {
    values.add(decodeURIComponent(databaseUrl));
  } catch {
    // The validated URL may contain a literal percent in an encoded password.
  }
  return [...values].sort((left, right) => right.length - left.length);
}

function redact(value, secrets, temporaryHome = "") {
  let text = asText(value);
  for (const secret of secrets) text = text.split(secret).join("[REDACTED]");
  text = text.replace(
    /postgres(?:ql)?:\/\/[^\s"'<>]+/giu,
    "postgresql://[REDACTED]",
  );
  if (temporaryHome) text = text.split(temporaryHome).join("[TEST_CLI_HOME]");
  return text;
}

function execute(file, args, options) {
  return new Promise((resolve, reject) => {
    execFile(file, args, options, (error, stdout, stderr) => {
      if (error) {
        error.stdout = stdout;
        error.stderr = stderr;
        reject(error);
        return;
      }
      resolve({ stdout, stderr });
    });
  });
}

function commandEnvironment(home) {
  return {
    CI: "true",
    HOME: home,
    NO_COLOR: "1",
    PATH: process.env.PATH ?? "",
    SUPABASE_TELEMETRY_DISABLED: "1",
    TERM: "dumb",
    TMPDIR: tmpdir(),
  };
}

export function createTestTargetCli({
  getOperatorSessionDatabaseUrl,
  rootDirectory = process.cwd(),
  runProcess = execute,
} = {}) {
  if (typeof getOperatorSessionDatabaseUrl !== "function") {
    throw new TestTargetCliError(
      "TEST operator database URL must be supplied by a private getter",
    );
  }
  if (typeof runProcess !== "function") {
    throw new TestTargetCliError("TEST CLI process runner is invalid");
  }

  const databaseUrl = validateOperatorDatabaseUrl(
    getOperatorSessionDatabaseUrl(),
  );
  const secrets = secretValues(databaseUrl);
  const root = path.resolve(rootDirectory);
  const binary = path.join(root, "node_modules", ".bin", "supabase");
  let versionVerified = false;

  async function invoke(label, args) {
    const home = mkdtempSync(path.join(tmpdir(), "gioia-test-cli-"));
    chmodSync(home, 0o700);
    mkdirSync(path.join(home, ".supabase"), { mode: 0o700 });
    const options = {
      cwd: root,
      encoding: "utf8",
      env: commandEnvironment(home),
      killSignal: "SIGTERM",
      maxBuffer: MAX_BUFFER_BYTES,
      timeout: COMMAND_TIMEOUT_MS,
      windowsHide: true,
    };

    try {
      if (!versionVerified) {
        const version = await runProcess(binary, ["--version"], {
          ...options,
          timeout: 30_000,
        });
        const actualVersion = redact(version.stdout, secrets, home).trim();
        if (actualVersion !== TEST_TARGET_SUPABASE_CLI_VERSION) {
          throw new TestTargetCliError(
            `Supabase CLI version must be ${TEST_TARGET_SUPABASE_CLI_VERSION}`,
          );
        }
        versionVerified = true;
      }

      const result = await runProcess(binary, args, options);
      return Object.freeze({
        stderr: redact(result.stderr, secrets, home),
        stdout: redact(result.stdout, secrets, home),
      });
    } catch (error) {
      if (error instanceof TestTargetCliError) throw error;
      const message = redact(error?.message ?? String(error), secrets, home);
      throw new TestTargetCliError(`${label} failed: ${message}`, {
        stderr: redact(error?.stderr, secrets, home),
        stdout: redact(error?.stdout, secrets, home),
      });
    } finally {
      rmSync(home, { force: true, recursive: true });
    }
  }

  async function verifyVersion() {
    const result = await invoke("Supabase CLI version check", ["--version"]);
    if (result.stdout.trim() !== TEST_TARGET_SUPABASE_CLI_VERSION) {
      throw new TestTargetCliError(
        `Supabase CLI version must be ${TEST_TARGET_SUPABASE_CLI_VERSION}`,
      );
    }
    return TEST_TARGET_SUPABASE_CLI_VERSION;
  }

  async function lintPrivateSchema() {
    return invoke("Supabase database lint", [
      "db",
      "lint",
      "--db-url",
      databaseUrl,
      "--schema",
      "gioia_private",
      "--level",
      "warning",
      "--fail-on",
      "warning",
    ]);
  }

  async function runAdvisors() {
    return invoke("Supabase database advisors", [
      "db",
      "advisors",
      "--db-url",
      databaseUrl,
      "--type",
      "all",
      "--level",
      "warn",
      "--fail-on",
      "warn",
    ]);
  }

  async function runRemotePgTap() {
    const suite = remotePgTapFiles(root);
    const result = await invoke("Supabase remote pgTAP", [
      "test",
      "db",
      "--db-url",
      databaseUrl,
      ...suite.files,
    ]);
    return Object.freeze({ ...result, ...suite });
  }

  return Object.freeze({
    lintPrivateSchema,
    runAdvisors,
    runRemotePgTap,
    verifyVersion,
  });
}

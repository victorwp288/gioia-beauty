import { execFile } from "node:child_process";
import { X509Certificate } from "node:crypto";
import {
  chmodSync,
  mkdirSync,
  mkdtempSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { createRemotePgTapRunner } from "./test-target-pgtap.mjs";

export const TEST_TARGET_SUPABASE_CLI_VERSION = "2.109.1";

const TEST_TARGET_REF = "hzibzwhrwmljgjjdzspi";
const TEST_TARGET_POOLER = /^aws-1-eu-central-2\.pooler\.supabase\.com$/u;
const MAX_BUFFER_BYTES = 16 * 1024 * 1024;
const COMMAND_TIMEOUT_MS = 10 * 60 * 1000;
const TEST_TARGET_CA_FINGERPRINT =
  "80:70:25:AD:50:D4:ED:21:9D:2C:9C:7D:29:9C:00:4F:82:4E:B0:0C:F7:F6:5A:FE:F6:07:D0:7B:72:E6:CA:FA";
const EXACT_LINT_STDOUT = '{"results":[],"message":"db lint"}\n';
const EXACT_LINT_STDERR =
  "Connecting to remote database...\n" +
  "Linting schema: gioia_private\n\n" +
  "No schema errors found\n";
const EXACT_ADVISORS_STDOUT = '{"results":[],"message":"db advisors"}\n';
const EXACT_ADVISORS_STDERR =
  "Connecting to remote database...\nNo issues found\n";

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
  databaseClient,
  getDatabaseCaCertificate,
  getOperatorSessionDatabaseUrl,
  remotePgTapQueryBoundaryWait,
  rootDirectory = process.cwd(),
  runProcess = execute,
} = {}) {
  if (typeof getOperatorSessionDatabaseUrl !== "function") {
    throw new TestTargetCliError(
      "TEST operator database URL must be supplied by a private getter",
    );
  }
  if (typeof getDatabaseCaCertificate !== "function") {
    throw new TestTargetCliError(
      "TEST database CA certificate must be supplied by a private getter",
    );
  }
  if (typeof runProcess !== "function") {
    throw new TestTargetCliError("TEST CLI process runner is invalid");
  }

  const databaseUrl = validateOperatorDatabaseUrl(
    getOperatorSessionDatabaseUrl(),
  );
  const certificatePem = getDatabaseCaCertificate();
  let certificate;
  try {
    certificate = new X509Certificate(certificatePem);
  } catch {
    throw new TestTargetCliError("TEST database CA certificate is invalid");
  }
  if (
    typeof certificatePem !== "string" ||
    !certificate.ca ||
    certificatePem !== certificate.toString() ||
    certificate.fingerprint256 !== TEST_TARGET_CA_FINGERPRINT
  ) {
    throw new TestTargetCliError("TEST database CA certificate is invalid");
  }
  const secrets = secretValues(databaseUrl);
  const root = path.resolve(rootDirectory);
  const binary = path.join(root, "node_modules", ".bin", "supabase");
  const runRemotePgTap = createRemotePgTapRunner({
    databaseClient,
    getDatabaseCaCertificate,
    getOperatorSessionDatabaseUrl,
    queryBoundaryWait: remotePgTapQueryBoundaryWait,
    rootDirectory: root,
  });
  let versionVerified = false;

  async function invoke(label, args) {
    let home = "";

    try {
      home = mkdtempSync(path.join(tmpdir(), "gioia-test-cli-"));
      chmodSync(home, 0o700);
      mkdirSync(path.join(home, ".supabase"), { mode: 0o700 });
      const certificatePath = path.join(home, "root.crt");
      writeFileSync(certificatePath, certificatePem, { mode: 0o600 });
      const commandDatabaseUrl = new URL(databaseUrl);
      commandDatabaseUrl.searchParams.set("sslrootcert", certificatePath);
      const commandArgs = args.map((argument) =>
        argument === databaseUrl ? commandDatabaseUrl.href : argument,
      );
      const options = {
        cwd: root,
        encoding: "utf8",
        env: commandEnvironment(home),
        killSignal: "SIGTERM",
        maxBuffer: MAX_BUFFER_BYTES,
        timeout: COMMAND_TIMEOUT_MS,
        windowsHide: true,
      };
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

      const result = await runProcess(binary, commandArgs, options);
      const redacted = Object.freeze({
        stderr: redact(result.stderr, secrets, home),
        stdout: redact(result.stdout, secrets, home),
      });
      for (const source of [redacted.stdout, redacted.stderr]) {
        try {
          const envelope = JSON.parse(source);
          if (
            envelope?._tag === "Error" ||
            envelope?.error?.code === "LegacyDbConnectError"
          ) {
            throw new TestTargetCliError(`${label} returned an error envelope`);
          }
        } catch (error) {
          if (error instanceof TestTargetCliError) throw error;
        }
      }
      return redacted;
    } catch (error) {
      if (error instanceof TestTargetCliError) throw error;
      const message = redact(error?.message ?? String(error), secrets, home);
      throw new TestTargetCliError(`${label} failed: ${message}`, {
        stderr: redact(error?.stderr, secrets, home),
        stdout: redact(error?.stdout, secrets, home),
      });
    } finally {
      if (home) rmSync(home, { force: true, recursive: true });
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
    const result = await invoke("Supabase database lint", [
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
      "--output-format",
      "json",
    ]);
    if (
      result.stdout !== EXACT_LINT_STDOUT ||
      result.stderr !== EXACT_LINT_STDERR
    ) {
      throw new TestTargetCliError("Supabase database lint output is invalid");
    }
    return result;
  }

  async function runAdvisors() {
    const result = await invoke("Supabase database advisors", [
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
      "--output-format",
      "json",
    ]);
    if (
      result.stdout !== EXACT_ADVISORS_STDOUT ||
      result.stderr !== EXACT_ADVISORS_STDERR
    ) {
      throw new TestTargetCliError(
        "Supabase database advisors output is invalid",
      );
    }
    return result;
  }

  return Object.freeze({
    lintPrivateSchema,
    runAdvisors,
    runRemotePgTap,
    verifyVersion,
  });
}

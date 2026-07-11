import {
  accessSync,
  constants,
  existsSync,
  readFileSync,
  statSync,
} from "node:fs";
import path from "node:path";

import { describe, expect, it, vi } from "vitest";

import {
  TEST_TARGET_SUPABASE_CLI_VERSION,
  TestTargetCliError,
  createTestTargetCli,
} from "../../scripts/test-target-cli.mjs";
import { remotePgTapFiles } from "../../scripts/test-target-migrations.mjs";

const PASSWORD = "operator-password-12345678901234567890";
const DATABASE_URL =
  `postgresql://postgres.lxvsspniipcotimbsfqm:${PASSWORD}` +
  "@aws-0-eu-central-2.pooler.supabase.com:5432/postgres?sslmode=verify-full";
const CERTIFICATE_PEM = readFileSync(
  "config/certificates/supabase-prod-ca-2021.crt",
  "utf8",
);
const LINT_STDOUT = '{"results":[],"message":"db lint"}\n';
const LINT_STDERR =
  "Connecting to remote database...\n" +
  "Linting schema: gioia_private\n\n" +
  "No schema errors found\n";
const ADVISORS_STDOUT = '{"results":[],"message":"db advisors"}\n';
const ADVISORS_STDERR = "Connecting to remote database...\nNo issues found\n";

function fakeRunner(overrides = {}) {
  const homes = [];
  const run = vi.fn(async (_file, args, options) => {
    homes.push(options.env.HOME);
    expect(existsSync(options.env.HOME)).toBe(true);
    accessSync(options.env.HOME, constants.W_OK);
    const certificatePath = path.join(options.env.HOME, "root.crt");
    expect(readFileSync(certificatePath, "utf8")).toBe(CERTIFICATE_PEM);
    expect(statSync(certificatePath).mode & 0o777).toBe(0o600);
    if (args[0] === "--version") {
      return {
        stderr: "",
        stdout: `${overrides.version ?? TEST_TARGET_SUPABASE_CLI_VERSION}\n`,
      };
    }
    if (overrides.error) throw overrides.error;
    if (args[0] === "db" && args[1] === "lint") {
      return {
        stderr: overrides.stderr ?? LINT_STDERR,
        stdout: overrides.stdout ?? LINT_STDOUT,
      };
    }
    if (args[0] === "db" && args[1] === "advisors") {
      return {
        stderr: overrides.stderr ?? ADVISORS_STDERR,
        stdout: overrides.stdout ?? ADVISORS_STDOUT,
      };
    }
    if (args[0] === "test" && args[1] === "db") {
      return {
        stderr: overrides.stderr ?? "",
        stdout: overrides.stdout ?? "Files=21, Tests=342\nResult: PASS\n",
      };
    }
    return {
      stderr: overrides.stderr ?? "",
      stdout: overrides.stdout ?? "ok\n",
    };
  });
  return { homes, run };
}

function client(runProcess) {
  return createTestTargetCli({
    getDatabaseCaCertificate: () => CERTIFICATE_PEM,
    getOperatorSessionDatabaseUrl: () => DATABASE_URL,
    runProcess,
  });
}

describe("greenfield TEST Supabase CLI", () => {
  it("uses the pinned local binary and a disposable, minimal HOME", async () => {
    const { homes, run } = fakeRunner();
    await client(run).verifyVersion();

    expect(run).toHaveBeenCalledTimes(2);
    const [binary, args, options] = run.mock.calls[0];
    expect(binary).toBe(
      path.join(process.cwd(), "node_modules", ".bin", "supabase"),
    );
    expect(args).toEqual(["--version"]);
    expect(options.env).toEqual({
      CI: "true",
      HOME: expect.any(String),
      NO_COLOR: "1",
      PATH: process.env.PATH ?? "",
      SUPABASE_TELEMETRY_DISABLED: "1",
      TERM: "dumb",
      TMPDIR: expect.any(String),
    });
    expect(options.env).not.toHaveProperty("SUPABASE_ACCESS_TOKEN");
    expect(run.mock.calls[1][1]).toEqual(["--version"]);
    expect(new Set(homes)).toHaveLength(1);
    expect(existsSync(homes[0])).toBe(false);
  });

  it("can verify the pinned CLI before any database mutation", async () => {
    const { run } = fakeRunner();
    await expect(client(run).verifyVersion()).resolves.toBe(
      TEST_TARGET_SUPABASE_CLI_VERSION,
    );
    expect(run).toHaveBeenCalledTimes(2);
    expect(run.mock.calls.every(([, args]) => args[0] === "--version")).toBe(
      true,
    );
  });

  it("runs strict lint and advisors with their reviewed command shapes", async () => {
    const { run } = fakeRunner();
    const cli = client(run);
    await cli.lintPrivateSchema();
    await cli.runAdvisors();

    expect(run.mock.calls[1][1].slice(0, 3)).toEqual([
      "db",
      "lint",
      "--db-url",
    ]);
    expect(run.mock.calls[1][1].slice(4)).toEqual([
      "--schema",
      "gioia_private",
      "--level",
      "warning",
      "--fail-on",
      "warning",
      "--output-format",
      "json",
    ]);
    expect(run.mock.calls[2][1].slice(0, 3)).toEqual([
      "db",
      "advisors",
      "--db-url",
    ]);
    expect(run.mock.calls[2][1].slice(4)).toEqual([
      "--type",
      "all",
      "--level",
      "warn",
      "--fail-on",
      "warn",
      "--output-format",
      "json",
    ]);
    for (const call of [run.mock.calls[1], run.mock.calls[2]]) {
      const url = new URL(call[1][3]);
      expect(url.searchParams.get("sslmode")).toBe("verify-full");
      expect(url.searchParams.get("sslrootcert")).toContain("root.crt");
      url.searchParams.delete("sslrootcert");
      expect(url.href).toBe(DATABASE_URL);
    }
  });

  it("passes all 21 reviewed remote pgTAP files explicitly", async () => {
    const { run } = fakeRunner();
    const result = await client(run).runRemotePgTap();
    const args = run.mock.calls[1][1];
    const suite = remotePgTapFiles();

    expect(result).toMatchObject({ assertions: 342, files: suite.files });
    expect(args.slice(0, 3)).toEqual(["test", "db", "--db-url"]);
    const databaseUrl = new URL(args[3]);
    expect(databaseUrl.searchParams.get("sslrootcert")).toContain("root.crt");
    databaseUrl.searchParams.delete("sslrootcert");
    expect(databaseUrl.href).toBe(DATABASE_URL);
    expect(args.slice(4)).toEqual(suite.files);
    expect(args).not.toContain("supabase/tests");
    expect(args.join(" ")).not.toContain("005_synthetic_seed.test.sql");
  });

  it("redacts database credentials from results and failures", async () => {
    const successful = fakeRunner();
    const result = await client(successful.run).lintPrivateSchema();
    expect(JSON.stringify(result)).not.toContain(PASSWORD);
    expect(JSON.stringify(result)).not.toContain(DATABASE_URL);
    expect(result).toEqual({
      stderr: LINT_STDERR,
      stdout: LINT_STDOUT,
    });

    const processError = Object.assign(
      new Error(`command failed for ${DATABASE_URL}`),
      {
        stderr: `password=${PASSWORD}`,
        stdout: DATABASE_URL,
      },
    );
    const failing = fakeRunner({ error: processError });
    const error = await client(failing.run)
      .lintPrivateSchema()
      .catch((caught) => caught);
    expect(error).toBeInstanceOf(TestTargetCliError);
    expect(JSON.stringify(error)).not.toContain(PASSWORD);
    expect(error.message).not.toContain(DATABASE_URL);
    expect(error.stdout).toBe("[REDACTED]");
    expect(error.stderr).toBe("password=[REDACTED]");
    expect(failing.homes.every((home) => !existsSync(home))).toBe(true);
  });

  it.each(["stdout", "stderr"])(
    "rejects a code-zero structured CLI error on %s",
    async (stream) => {
      const envelope = JSON.stringify({
        _tag: "Error",
        error: { code: "LegacyDbConnectError", detail: PASSWORD },
      });
      const runner = fakeRunner({
        stderr: stream === "stderr" ? envelope : LINT_STDERR,
        stdout: stream === "stdout" ? envelope : LINT_STDOUT,
      });
      const error = await client(runner.run)
        .lintPrivateSchema()
        .catch((caught) => caught);
      expect(error).toBeInstanceOf(TestTargetCliError);
      expect(error.message).toContain("error envelope");
      expect(JSON.stringify(error)).not.toContain(PASSWORD);
    },
  );

  it("requires exact lint, advisor, and pgTAP success evidence", async () => {
    await expect(
      client(
        fakeRunner({ stderr: "lint maybe passed\n" }).run,
      ).lintPrivateSchema(),
    ).rejects.toThrow("lint output is invalid");
    await expect(
      client(fakeRunner({ stderr: "No findings maybe\n" }).run).runAdvisors(),
    ).rejects.toThrow("advisors output is invalid");
    for (const stdout of [
      "Files=20, Tests=342\nResult: PASS\n",
      "Files=21, Tests=341\nResult: PASS\n",
      "Files=21, Tests=3420\nResult: PASS\n",
      "Files=21, Tests=342\nResult: PASSING\n",
      "Files=21, Tests=342\nResult: FAIL\n",
      "not ok 1 - failed\nFiles=21, Tests=342\nResult: PASS\n",
      "    not ok 1 - failed\nFiles=21, Tests=342\nResult: PASS\n",
      "Bail out! unexpected failure\nFiles=21, Tests=342\nResult: PASS\n",
    ]) {
      await expect(
        client(fakeRunner({ stdout }).run).runRemotePgTap(),
      ).rejects.toThrow("pgTAP output is invalid");
    }
  });

  it("rejects the wrong binary version and any non-TEST database target", async () => {
    const wrongVersion = fakeRunner({ version: "2.110.0" });
    await expect(client(wrongVersion.run).lintPrivateSchema()).rejects.toThrow(
      `must be ${TEST_TARGET_SUPABASE_CLI_VERSION}`,
    );
    expect(wrongVersion.run).toHaveBeenCalledTimes(1);

    expect(() =>
      createTestTargetCli({
        getDatabaseCaCertificate: () => CERTIFICATE_PEM,
        getOperatorSessionDatabaseUrl: () =>
          DATABASE_URL.replace("lxvsspniipcotimbsfqm", "production-project"),
      }),
    ).toThrow("not the exact greenfield TEST session pooler");
    expect(() =>
      createTestTargetCli({
        getDatabaseCaCertificate: () => `${CERTIFICATE_PEM}${CERTIFICATE_PEM}`,
        getOperatorSessionDatabaseUrl: () => DATABASE_URL,
      }),
    ).toThrow("CA certificate is invalid");
    expect(() =>
      createTestTargetCli({
        getDatabaseCaCertificate: () => CERTIFICATE_PEM,
        getOperatorSessionDatabaseUrl: () =>
          DATABASE_URL.replace("sslmode=verify-full", "sslmode=require"),
      }),
    ).toThrow("not the exact greenfield TEST session pooler");
    expect(() =>
      createTestTargetCli({
        getOperatorSessionDatabaseUrl: () => DATABASE_URL,
      }),
    ).toThrow("CA certificate must be supplied");
    expect(() => createTestTargetCli()).toThrow("private getter");
  });
});

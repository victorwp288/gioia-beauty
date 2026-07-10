import { accessSync, constants, existsSync } from "node:fs";
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

function fakeRunner(overrides = {}) {
  const homes = [];
  const run = vi.fn(async (_file, args, options) => {
    homes.push(options.env.HOME);
    expect(existsSync(options.env.HOME)).toBe(true);
    accessSync(options.env.HOME, constants.W_OK);
    if (args[0] === "--version") {
      return {
        stderr: "",
        stdout: `${overrides.version ?? TEST_TARGET_SUPABASE_CLI_VERSION}\n`,
      };
    }
    if (overrides.error) throw overrides.error;
    return {
      stderr: overrides.stderr ?? "",
      stdout: overrides.stdout ?? "ok\n",
    };
  });
  return { homes, run };
}

function client(runProcess) {
  return createTestTargetCli({
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

    expect(run.mock.calls[1][1]).toEqual([
      "db",
      "lint",
      "--db-url",
      DATABASE_URL,
      "--schema",
      "gioia_private",
      "--level",
      "warning",
      "--fail-on",
      "warning",
    ]);
    expect(run.mock.calls[2][1]).toEqual([
      "db",
      "advisors",
      "--db-url",
      DATABASE_URL,
      "--type",
      "all",
      "--level",
      "warn",
      "--fail-on",
      "warn",
    ]);
  });

  it("passes all 21 reviewed remote pgTAP files explicitly", async () => {
    const { run } = fakeRunner();
    const result = await client(run).runRemotePgTap();
    const args = run.mock.calls[1][1];
    const suite = remotePgTapFiles();

    expect(result).toMatchObject({ assertions: 342, files: suite.files });
    expect(args.slice(0, 4)).toEqual(["test", "db", "--db-url", DATABASE_URL]);
    expect(args.slice(4)).toEqual(suite.files);
    expect(args).not.toContain("supabase/tests");
    expect(args.join(" ")).not.toContain("005_synthetic_seed.test.sql");
  });

  it("redacts database credentials from results and failures", async () => {
    const successful = fakeRunner({
      stderr: `warning: ${DATABASE_URL}`,
      stdout: `password=${PASSWORD}`,
    });
    const result = await client(successful.run).lintPrivateSchema();
    expect(JSON.stringify(result)).not.toContain(PASSWORD);
    expect(JSON.stringify(result)).not.toContain(DATABASE_URL);
    expect(result).toEqual({
      stderr: "warning: [REDACTED]",
      stdout: "password=[REDACTED]",
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

  it("rejects the wrong binary version and any non-TEST database target", async () => {
    const wrongVersion = fakeRunner({ version: "2.110.0" });
    await expect(client(wrongVersion.run).lintPrivateSchema()).rejects.toThrow(
      `must be ${TEST_TARGET_SUPABASE_CLI_VERSION}`,
    );
    expect(wrongVersion.run).toHaveBeenCalledTimes(1);

    expect(() =>
      createTestTargetCli({
        getOperatorSessionDatabaseUrl: () =>
          DATABASE_URL.replace("lxvsspniipcotimbsfqm", "production-project"),
      }),
    ).toThrow("not the exact greenfield TEST session pooler");
    expect(() =>
      createTestTargetCli({
        getOperatorSessionDatabaseUrl: () =>
          DATABASE_URL.replace("sslmode=verify-full", "sslmode=require"),
      }),
    ).toThrow("not the exact greenfield TEST session pooler");
    expect(() => createTestTargetCli()).toThrow("private getter");
  });
});

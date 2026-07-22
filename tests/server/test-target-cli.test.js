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
import {
  REMOTE_PGTAP_CLEANUP_SQL,
  REMOTE_PGTAP_NEWSLETTER_FIXTURE_FILES,
  REMOTE_PGTAP_NEWSLETTER_FIXTURE_SQL,
  REMOTE_PGTAP_ROLLBACK_SQL,
  REMOTE_PGTAP_SETUP_SQL,
  REMOTE_PGTAP_STATEMENT_TIMESTAMP_BOUNDARY,
  REMOTE_PGTAP_STATEMENT_TIMESTAMP_DELAY_MS,
  remotePgTapQuerySegments,
  withRemotePgTapFixtures,
} from "../../scripts/test-target-pgtap.mjs";

const PASSWORD = "operator-password-12345678901234567890";
const DATABASE_URL =
  `postgresql://postgres.hzibzwhrwmljgjjdzspi:${PASSWORD}` +
  "@aws-1-eu-central-2.pooler.supabase.com:5432/postgres?sslmode=verify-full";
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
    return {
      stderr: overrides.stderr ?? "",
      stdout: overrides.stdout ?? "ok\n",
    };
  });
  return { homes, run };
}

function passingPgTapResults(source) {
  const plan = source.match(/select plan\((\d+)\);/u)?.[1];
  if (source.includes("unknown unsubscribe tokens do not enumerate")) {
    return [
      [{ plan: "1..18" }],
      ...Array.from({ length: 13 }, (_, index) => [
        { result: `ok ${index + 1} - synthetic pass` },
      ]),
    ];
  }
  if (source.includes("a fresh double-opt-in cycle")) {
    return Array.from({ length: 5 }, (_, index) => [
      { result: `ok ${index + 14} - synthetic pass` },
    ]);
  }
  if (plan === undefined) return [];
  const assertions = Number(plan);
  return [
    [{ plan: `1..${assertions}` }],
    ...Array.from({ length: assertions }, (_, index) => [
      { result: `ok ${index + 1} - synthetic pass` },
    ]),
  ];
}

function fakePgTapDatabase(resultFactory = passingPgTapResults) {
  const sql = {
    end: vi.fn(async () => {}),
    unsafe: vi.fn(async (source) => {
      if (
        source === REMOTE_PGTAP_ROLLBACK_SQL ||
        source === REMOTE_PGTAP_CLEANUP_SQL ||
        source === REMOTE_PGTAP_SETUP_SQL
      ) {
        return [];
      }
      return resultFactory(source);
    }),
  };
  return { client: vi.fn(() => sql), sql };
}

function client(
  runProcess,
  databaseClient = fakePgTapDatabase().client,
  remotePgTapQueryBoundaryWait,
) {
  return createTestTargetCli({
    databaseClient,
    getDatabaseCaCertificate: () => CERTIFICATE_PEM,
    getOperatorSessionDatabaseUrl: () => DATABASE_URL,
    remotePgTapQueryBoundaryWait,
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

  it("passes all 30 reviewed remote pgTAP files explicitly", async () => {
    const { run } = fakeRunner();
    const database = fakePgTapDatabase();
    const boundaryWait = vi.fn(async () => {});
    const result = await client(
      run,
      database.client,
      boundaryWait,
    ).runRemotePgTap();
    const suite = remotePgTapFiles();

    expect(result).toMatchObject({ assertions: 473, files: suite.files });
    expect(run).not.toHaveBeenCalled();
    expect(database.client).toHaveBeenCalledWith(
      DATABASE_URL,
      expect.objectContaining({
        max: 1,
        prepare: false,
        ssl: { ca: CERTIFICATE_PEM, rejectUnauthorized: true },
      }),
    );
    const testCalls = database.sql.unsafe.mock.calls.filter(
      ([, , options]) => options?.simple === true,
    );
    expect(testCalls).toHaveLength(32);
    expect(
      testCalls.every(
        ([, args, options]) => args.length === 0 && options.simple === true,
      ),
    ).toBe(true);
    expect(
      testCalls.some(([source]) =>
        source.includes("a fresh double-opt-in cycle"),
      ),
    ).toBe(true);
    const secondSegmentCall = database.sql.unsafe.mock.calls.findIndex(
      ([source]) => source.includes("a fresh double-opt-in cycle"),
    );
    expect(boundaryWait).toHaveBeenCalledTimes(2);
    expect(boundaryWait).toHaveBeenNthCalledWith(
      1,
      REMOTE_PGTAP_STATEMENT_TIMESTAMP_DELAY_MS,
    );
    expect(boundaryWait).toHaveBeenNthCalledWith(
      2,
      REMOTE_PGTAP_STATEMENT_TIMESTAMP_DELAY_MS,
    );
    expect(boundaryWait.mock.invocationCallOrder[0]).toBeLessThan(
      database.sql.unsafe.mock.invocationCallOrder[secondSegmentCall],
    );
    expect(database.sql.unsafe).toHaveBeenNthCalledWith(
      34,
      REMOTE_PGTAP_ROLLBACK_SQL,
    );
    expect(database.sql.unsafe).toHaveBeenNthCalledWith(
      35,
      REMOTE_PGTAP_CLEANUP_SQL,
    );
    expect(database.sql.end).toHaveBeenCalledWith({ timeout: 5 });
  });

  it("starts fresh hosted statement timestamps before re-subscription", () => {
    const cases = [
      {
        file: "supabase/tests/080_subscriber_commands.test.sql",
        first: "unknown unsubscribe tokens",
        second: "a fresh double-opt-in cycle",
      },
      {
        file: "supabase/tests/100_verified_webhook_commands.test.sql",
        first: "the old generation is unsubscribed",
        second: "re-subscribe creates a newer pending generation",
      },
    ];

    expect(REMOTE_PGTAP_STATEMENT_TIMESTAMP_DELAY_MS).toBe(5);
    for (const { file, first, second } of cases) {
      const source = readFileSync(file, "utf8");
      const segments = remotePgTapQuerySegments(file, source);
      expect(
        source.split(REMOTE_PGTAP_STATEMENT_TIMESTAMP_BOUNDARY),
      ).toHaveLength(2);
      expect(segments).toHaveLength(2);
      expect(segments[0]).toContain(first);
      expect(segments[1]).toContain(second);
      expect(() =>
        remotePgTapQuerySegments(
          file,
          source.replace(REMOTE_PGTAP_STATEMENT_TIMESTAMP_BOUNDARY, ""),
        ),
      ).toThrow("statement timestamp boundary is invalid");
    }
    expect(() =>
      remotePgTapQuerySegments(
        "supabase/tests/010_catalog_policy.test.sql",
        `select plan(1);\n${REMOTE_PGTAP_STATEMENT_TIMESTAMP_BOUNDARY}\nrollback;`,
      ),
    ).toThrow("statement timestamp boundary is invalid");
  });

  it("injects rollback-only newsletter configuration into only the dependent remote tests", () => {
    const source = "begin;\nselect plan(1);\nrollback;\n";
    for (const file of REMOTE_PGTAP_NEWSLETTER_FIXTURE_FILES) {
      const prepared = withRemotePgTapFixtures(file, source);
      expect(
        prepared.startsWith(`begin;\n${REMOTE_PGTAP_NEWSLETTER_FIXTURE_SQL}`),
      ).toBe(true);
      expect(prepared).toContain("newsletter-consent-v1.it-1");
      expect(prepared).toContain("'local_1', true");
      expect(prepared.endsWith("select plan(1);\nrollback;\n")).toBe(true);
    }
    expect(withRemotePgTapFixtures("010_catalog_policy.test.sql", source)).toBe(
      source,
    );
    expect(() =>
      withRemotePgTapFixtures(
        REMOTE_PGTAP_NEWSLETTER_FIXTURE_FILES[0],
        "select plan(1);",
      ),
    ).toThrow("fixture transaction is invalid");
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
  });

  it.each([
    [[[{ plan: "1..1" }], [{ result: "not ok 1 - failed" }]]],
    [[[{ plan: "1..1" }], [{ result: "    not ok 1 - failed" }]]],
    [[[{ plan: "1..1" }], [{ result: "Bail out! failed" }]]],
    [[[{ plan: "1..10" }], [{ result: "ok 1 - incomplete" }]]],
  ])("rejects invalid direct pgTAP result evidence", async (results) => {
    const database = fakePgTapDatabase(() => results);
    await expect(
      client(fakeRunner().run, database.client).runRemotePgTap(),
    ).rejects.toThrow("Remote pgTAP result failed");
    expect(database.sql.end).toHaveBeenCalledWith({ timeout: 5 });
  });

  it("normalizes synchronous pgTAP client failures without reflecting credentials", async () => {
    const databaseClient = vi.fn(() => {
      throw new Error(`connection failed for ${DATABASE_URL}`);
    });
    const error = await client(fakeRunner().run, databaseClient)
      .runRemotePgTap()
      .catch((caught) => caught);

    expect(error).toMatchObject({
      name: "TestTargetPgTapError",
      message: "Remote pgTAP execution failed",
    });
    expect(JSON.stringify(error)).not.toContain(PASSWORD);
    expect(JSON.stringify(error)).not.toContain(DATABASE_URL);
  });

  it("attempts extension cleanup and pool closure after execution and rollback failures", async () => {
    const sql = {
      end: vi.fn(async () => {}),
      unsafe: vi.fn(async (source) => {
        if (source === REMOTE_PGTAP_ROLLBACK_SQL) {
          throw new Error("synthetic rollback failure");
        }
        if (source === REMOTE_PGTAP_CLEANUP_SQL) return [];
        throw new Error("synthetic pgTAP execution failure");
      }),
    };
    const error = await client(fakeRunner().run, () => sql)
      .runRemotePgTap()
      .catch((caught) => caught);

    expect(error).toBeInstanceOf(AggregateError);
    expect(error.message).toBe("Remote pgTAP execution and cleanup failed");
    expect(sql.unsafe).toHaveBeenCalledWith(REMOTE_PGTAP_CLEANUP_SQL);
    expect(sql.end).toHaveBeenCalledWith({ timeout: 5 });
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
          DATABASE_URL.replace("hzibzwhrwmljgjjdzspi", "production-project"),
      }),
    ).toThrow("not the exact greenfield TEST session pooler");
    expect(() =>
      createTestTargetCli({
        getDatabaseCaCertificate: () => CERTIFICATE_PEM,
        getOperatorSessionDatabaseUrl: () =>
          DATABASE_URL.replace(
            "aws-1-eu-central-2.pooler.supabase.com",
            "aws-0-eu-central-2.pooler.supabase.com",
          ),
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

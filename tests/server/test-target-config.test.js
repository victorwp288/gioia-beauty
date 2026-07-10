import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import {
  parseTestTargetConfig,
  TEST_TARGET_API_URL,
  TEST_TARGET_REF,
  TestTargetConfigError,
} from "../../scripts/test-target-config.mjs";

const RUN_ID = "018f5f50-a48b-7f3c-8b28-55f43fd91df0";
const OPERATOR_PASSWORD = "Operator!Password-Only-In-Memory";
const PUBLISHABLE_KEY = `sb_publishable_${"p".repeat(32)}`;
const POOLER_HOST = "aws-17-eu-central-2.pooler.supabase.com";

const temporaryDirectories = [];

function emptyWorkspace() {
  const directory = mkdtempSync(path.join(tmpdir(), "gioia-test-target-"));
  temporaryDirectories.push(directory);
  return directory;
}

function validEnvironment(overrides = {}) {
  return {
    APP_ENV: "operator",
    GIOIA_TEST_RUN_ID: RUN_ID,
    GIOIA_TEST_OPERATOR_DATABASE_URL:
      `postgresql://postgres.${TEST_TARGET_REF}:` +
      `${OPERATOR_PASSWORD}@${POOLER_HOST}:5432/postgres?sslmode=require`,
    NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: PUBLISHABLE_KEY,
    NEXT_PUBLIC_SUPABASE_URL: TEST_TARGET_API_URL,
    SUPABASE_PROJECT_REF: TEST_TARGET_REF,
    ...overrides,
  };
}

function parse(env = validEnvironment(), options = {}) {
  return parseTestTargetConfig(env, {
    execArgv: [],
    rootDirectory: emptyWorkspace(),
    ...options,
  });
}

function rejection(env, options) {
  try {
    parse(env, options);
    throw new Error("expected TEST target configuration to be rejected");
  } catch (error) {
    expect(error).toBeInstanceOf(TestTargetConfigError);
    return error;
  }
}

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    rmSync(directory, { recursive: true, force: true });
  }
});

describe("greenfield TEST target configuration", () => {
  it("accepts only the registered operator target and emits safe metadata", () => {
    const config = parse();

    expect(config).toMatchObject({
      apiUrl: `${TEST_TARGET_API_URL}/`,
      appEnv: "operator",
      environment: "test",
      operatorSessionPort: 5432,
      operatorWorkerPort: 6543,
      poolerHost: POOLER_HOST,
      poolerRegion: "eu-central-2",
      projectRef: TEST_TARGET_REF,
      runId: RUN_ID,
      sslmode: "require",
    });
    const diagnostic = JSON.stringify(config);
    expect(diagnostic).not.toContain(OPERATOR_PASSWORD);
    expect(diagnostic).not.toContain(PUBLISHABLE_KEY);
    expect(diagnostic).not.toContain("postgresql://");
    expect(Object.keys(config)).not.toEqual(
      expect.arrayContaining([
        "deriveAppRuntimeDatabaseUrl",
        "getOperatorSessionDatabaseUrl",
        "getOperatorWorkerDatabaseUrl",
        "getPublishableKey",
      ]),
    );
  });

  it("derives session, worker, and app_runtime URLs only through closures", () => {
    const env = validEnvironment();
    const config = parse(env);
    const runtimePassword = "Runtime/Password?With#Reserved=Chars-12345";

    const session = new URL(config.getOperatorSessionDatabaseUrl());
    const worker = new URL(config.getOperatorWorkerDatabaseUrl());
    const runtime = new URL(
      config.deriveAppRuntimeDatabaseUrl(runtimePassword),
    );

    expect(session.port).toBe("5432");
    expect(worker.port).toBe("6543");
    expect(decodeURIComponent(worker.username)).toBe(
      `postgres.${TEST_TARGET_REF}`,
    );
    expect(decodeURIComponent(runtime.username)).toBe(
      `app_runtime.${TEST_TARGET_REF}`,
    );
    expect(decodeURIComponent(runtime.password)).toBe(runtimePassword);
    expect(runtime.port).toBe("6543");
    expect(runtime.search).toBe("?sslmode=require");
    expect(config.getPublishableKey()).toBe(PUBLISHABLE_KEY);

    env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY = "sb_publishable_changed";
    env.GIOIA_TEST_OPERATOR_DATABASE_URL = "postgresql://changed";
    expect(config.getPublishableKey()).toBe(PUBLISHABLE_KEY);
    expect(config.getOperatorSessionDatabaseUrl()).toBe(session.href);
  });

  it.each([
    ["APP_ENV", "test"],
    ["SUPABASE_PROJECT_REF", "attacker-project"],
    ["GIOIA_TEST_RUN_ID", "not-a-uuid"],
    ["NEXT_PUBLIC_SUPABASE_URL", "http://lxvsspniipcotimbsfqm.supabase.co"],
    ["NEXT_PUBLIC_SUPABASE_URL", "https://attacker.supabase.co"],
    ["NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY", "legacy-anon-jwt"],
  ])("rejects a non-exact %s", (key, value) => {
    expect(() => parse(validEnvironment({ [key]: value }))).toThrow(
      TestTargetConfigError,
    );
  });

  it.each([
    "postgresql://postgres.lxvsspniipcotimbsfqm:secret@db.lxvsspniipcotimbsfqm.supabase.co:5432/postgres?sslmode=require",
    "postgresql://postgres.wrong:secret@aws-1-eu-central-2.pooler.supabase.com:5432/postgres?sslmode=require",
    "postgresql://postgres.lxvsspniipcotimbsfqm:secret@aws-1-eu-central-1.pooler.supabase.com:5432/postgres?sslmode=require",
    "postgresql://postgres.lxvsspniipcotimbsfqm:secret@aws-1-eu-central-2.pooler.supabase.com:6543/postgres?sslmode=require",
    "postgresql://postgres.lxvsspniipcotimbsfqm:secret@aws-1-eu-central-2.pooler.supabase.com:5432/postgres",
    "postgresql://postgres.lxvsspniipcotimbsfqm:secret@aws-1-eu-central-2.pooler.supabase.com:5432/postgres?sslmode=prefer",
    "postgresql://postgres.lxvsspniipcotimbsfqm:secret@aws-1-eu-central-2.pooler.supabase.com:5432/postgres?sslmode=require&application_name=gioia",
  ])("rejects a non-exact operator DSN", (databaseUrl) => {
    const error = rejection(
      validEnvironment({ GIOIA_TEST_OPERATOR_DATABASE_URL: databaseUrl }),
    );
    expect(error.message).not.toContain(databaseUrl);
    expect(error.message).not.toContain("secret");
  });

  it.each([
    ["SUPABASE_DATABASE_URL", "postgresql://application:secret@host/db"],
    ["DATABASE_URL", "postgresql://application:secret@host/db"],
    ["POSTGRES_URL", "postgresql://application:secret@host/db"],
    ["GIOIA_PRODUCTION_APPROVAL_ID", "production-approval"],
    ["NEXT_PUBLIC_FIREBASE_PROJECT_ID", "demo-gioia-beauty"],
    ["RESEND_API_KEY", "re_secret"],
    ["SUPABASE_SERVICE_ROLE_KEY", "sb_secret_value"],
    ["SUPABASE_ACCESS_TOKEN", "management-token"],
    ["GIOIA_TEST_OWNER_PASSWORD", "owner-password"],
    ["GIOIA_TEST_OWNER_PASSWORD", ""],
    ["VERCEL", "1"],
    ["VERCEL_TARGET_ENV", "production"],
    ["PGHOST", "production.database.internal"],
    ["PGHOSTADDR", "203.0.113.10"],
    ["PGHOSTADDR", ""],
    ["PGPASSWORD", "libpq-secret"],
    ["PGPASSWORD", ""],
    ["PGSSLNEGOTIATION", "direct"],
    ["PG_FUTURE_OVERRIDE", "unexpected"],
    ["SUPABASE_DB_URL", "postgresql://unexpected"],
    ["SUPABASE_PROJECT_ID", TEST_TARGET_REF],
    ["NEXT_PUBLIC_SUPABASE_PROJECT_ID", TEST_TARGET_REF],
    ["NEXT_PUBLIC_SUPABASE_SERVICE_KEY", ""],
  ])(
    "rejects forbidden operator variable %s without echoing it",
    (key, value) => {
      const error = rejection(validEnvironment({ [key]: value }));
      expect(error.message).toContain(key);
      if (value) expect(error.message).not.toContain(value);
    },
  );

  it("rejects dotenv files and loader flags while allowing examples", () => {
    const allowedRoot = emptyWorkspace();
    writeFileSync(path.join(allowedRoot, ".ENV.EXAMPLE"), "SAFE=example\n");
    expect(() =>
      parseTestTargetConfig(validEnvironment(), {
        execArgv: [],
        rootDirectory: allowedRoot,
      }),
    ).not.toThrow();

    for (const dotenvName of [".env.local", ".ENV", ".ENV.LOCAL"]) {
      const forbiddenRoot = emptyWorkspace();
      writeFileSync(path.join(forbiddenRoot, dotenvName), "SECRET=value\n");
      const error = rejection(validEnvironment(), {
        rootDirectory: forbiddenRoot,
      });
      expect(error.message).toContain("dotenv files are forbidden");
    }

    for (const execArgv of [
      ["--env-file=.env.operator"],
      ["--import=dotenv/config"],
      ["--require", "dotenv/config"],
      ["-r", "./node_modules/dotenv/config.js"],
    ]) {
      expect(() => parse(validEnvironment(), { execArgv })).toThrow(
        "Node dotenv loading is forbidden",
      );
    }
    expect(() =>
      parse(validEnvironment({ DOTENV_CONFIG_PATH: ".env.operator" })),
    ).toThrow("dotenv loader settings are forbidden");
  });

  it("validates runtime passwords without including them in failures", () => {
    const config = parse();
    const unsafePassword = "short-secret";

    expect(() => config.deriveAppRuntimeDatabaseUrl(unsafePassword)).toThrow(
      "in-memory app_runtime password must contain 32 to 256 bytes",
    );
    try {
      config.deriveAppRuntimeDatabaseUrl(unsafePassword);
    } catch (error) {
      expect(error.message).not.toContain(unsafePassword);
    }
  });
});

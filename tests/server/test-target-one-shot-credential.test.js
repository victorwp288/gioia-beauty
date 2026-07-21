import { EventEmitter } from "node:events";
import { readFileSync } from "node:fs";
import { PassThrough } from "node:stream";

import { describe, expect, it, vi } from "vitest";

import {
  resolveProtectedPsqlPath,
  verifyOneShotRuntimeCredential,
} from "../../scripts/test-target-one-shot-credential.mjs";

const PASSWORD = "Protected!Password-Only-In-Memory-12345";
const PSQL_PATH = "/opt/homebrew/Cellar/postgresql@17/17.10/bin/psql";
const DATABASE_URL = `postgresql://app_runtime.hzibzwhrwmljgjjdzspi:${PASSWORD}@aws-1-eu-central-2.pooler.supabase.com:6543/postgres?sslmode=verify-full`;
const CA_CERTIFICATE = readFileSync(
  "config/certificates/supabase-prod-ca-2021.crt",
  "utf8",
);

function processHarness({ code = 0, error = null, output = "t\nt\n" } = {}) {
  const child = Object.assign(new EventEmitter(), {
    kill: vi.fn(),
    stderr: new PassThrough(),
    stdout: new PassThrough(),
  });
  const processFactory = vi.fn(() => {
    queueMicrotask(() => {
      if (error) {
        child.emit("error", error);
        return;
      }
      child.stdout.end(output);
      child.stderr.end();
      child.emit("close", code, null);
    });
    return child;
  });
  return { child, processFactory };
}

function verify(overrides = {}) {
  return verifyOneShotRuntimeCredential({
    authenticateSql: "select true as authorized",
    authorizeSql: "select true as authorized",
    assumeSql: "select true where false",
    caCertificate: CA_CERTIFICATE,
    credentialLabel: "synthetic credential",
    databaseUrl: DATABASE_URL,
    psqlPath: PSQL_PATH,
    psqlResolver: () => PSQL_PATH,
    ...overrides,
  });
}

describe("greenfield TEST one-shot credential transport", () => {
  it("spawns exactly one psql process with the secret only in isolated env", async () => {
    const state = processHarness();

    await verify({ processFactory: state.processFactory });

    expect(state.processFactory).toHaveBeenCalledOnce();
    const [command, args, options] = state.processFactory.mock.calls[0];
    expect(command).toBe(PSQL_PATH);
    expect(JSON.stringify(args)).not.toContain(PASSWORD);
    expect(JSON.stringify(args)).not.toContain(DATABASE_URL);
    expect(options.env.PGPASSWORD).toBe(PASSWORD);
    expect(options.env.PGUSER).toBe("app_runtime.hzibzwhrwmljgjjdzspi");
    expect(options.env.PGPORT).toBe("6543");
    expect(Object.keys(options.env).sort()).toEqual(
      [
        "LANG",
        "LC_ALL",
        "PGAPPNAME",
        "PGCONNECT_TIMEOUT",
        "PGDATABASE",
        "PGHOST",
        "PGPASSWORD",
        "PGPORT",
        "PGSSLMODE",
        "PGSSLROOTCERT",
        "PGUSER",
      ].sort(),
    );
  });

  it.each([{ code: 2 }, { error: new Error(PASSWORD) }, { output: "f\nt\n" }])(
    "fails generically without spawning again",
    async (failure) => {
      const state = processHarness(failure);

      const error = await verify({
        processFactory: state.processFactory,
      }).catch((caught) => caught);

      expect(error.message).toBe(
        "Greenfield TEST synthetic credential could not authenticate",
      );
      expect(error.message).not.toContain(PASSWORD);
      expect(state.processFactory).toHaveBeenCalledOnce();
    },
  );

  it("redacts a synchronous process startup failure", async () => {
    const processFactory = vi.fn(() => {
      throw new Error(PASSWORD);
    });

    const error = await verify({ processFactory }).catch((caught) => caught);

    expect(error.message).toBe(
      "Greenfield TEST synthetic credential could not authenticate",
    );
    expect(error.message).not.toContain(PASSWORD);
    expect(processFactory).toHaveBeenCalledOnce();
  });

  it("rejects a PATH-resolved psql before exposing the credential", async () => {
    const processFactory = vi.fn();

    await expect(
      verify({
        processFactory,
        psqlPath: "psql",
        psqlResolver: resolveProtectedPsqlPath,
      }),
    ).rejects.toThrow(
      "Greenfield TEST synthetic credential could not authenticate",
    );
    expect(processFactory).not.toHaveBeenCalled();
  });

  it("accepts only a realpath under an allowlisted PostgreSQL 17 binary", () => {
    expect(
      resolveProtectedPsqlPath(undefined, {
        platform: "darwin",
        realpathImpl: (candidate) => {
          expect(candidate).toBe("/opt/homebrew/bin/psql");
          return PSQL_PATH;
        },
      }),
    ).toBe(PSQL_PATH);
    expect(() =>
      resolveProtectedPsqlPath("psql", {
        realpathImpl: () => "/synthetic/repository/node_modules/.bin/psql",
      }),
    ).toThrow("psql binary is not allowlisted");
  });

  it("kills one hung process at the bound without retrying", async () => {
    vi.useFakeTimers();
    try {
      const child = Object.assign(new EventEmitter(), {
        kill: vi.fn(() => {
          queueMicrotask(() => child.emit("close", null, "SIGKILL"));
          return true;
        }),
        stderr: new PassThrough(),
        stdout: new PassThrough(),
      });
      const processFactory = vi.fn(() => child);
      const result = verify({ processFactory, timeoutMs: 10 }).catch(
        (error) => error,
      );

      await vi.advanceTimersByTimeAsync(10);
      const error = await result;

      expect(error.message).toBe(
        "Greenfield TEST synthetic credential could not authenticate",
      );
      expect(processFactory).toHaveBeenCalledOnce();
      expect(child.kill).toHaveBeenCalledOnce();
      expect(child.kill).toHaveBeenCalledWith("SIGKILL");
    } finally {
      vi.useRealTimers();
    }
  });

  it("fails generically if a killed process cannot be reaped", async () => {
    vi.useFakeTimers();
    try {
      const child = Object.assign(new EventEmitter(), {
        kill: vi.fn(() => false),
        stderr: new PassThrough(),
        stdout: new PassThrough(),
      });
      const processFactory = vi.fn(() => child);
      const result = verify({
        processFactory,
        reapTimeoutMs: 5,
        timeoutMs: 10,
      }).catch((error) => error);

      await vi.advanceTimersByTimeAsync(15);
      const error = await result;

      expect(error.message).toBe(
        "Greenfield TEST synthetic credential could not authenticate",
      );
      expect(processFactory).toHaveBeenCalledOnce();
      expect(child.kill).toHaveBeenCalledTimes(2);
    } finally {
      vi.useRealTimers();
    }
  });
});

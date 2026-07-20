import { writeFileSync } from "node:fs";
import { chmod, mkdir, mkdtemp, rm, rmdir } from "node:fs/promises";

import { vi } from "vitest";

import { LOCAL_POSTGRES_MINIMUM_FREE_BYTES } from "../../../scripts/local-postgres-clone-contract.mjs";

export const LOCAL_CLONE_PASSWORD = "synthetic-local-password";
export const LOCAL_CLONE_ENVIRONMENT = Object.freeze({
  GIOIA_LOCAL_SUPABASE_API_PORT: "56321",
  GIOIA_LOCAL_SUPABASE_DB_PORT: "56322",
});

export function localCloneStatus(overrides = {}) {
  return {
    API_URL: "http://127.0.0.1:56321",
    DB_URL: `postgresql://postgres:${LOCAL_CLONE_PASSWORD}@127.0.0.1:56322/postgres`,
    ...overrides,
  };
}

export function localCloneStorage() {
  return {
    chmod,
    mkdir,
    mkdtemp,
    rm,
    rmdir,
    statfs: vi.fn(async () => ({
      bavail: LOCAL_POSTGRES_MINIMUM_FREE_BYTES,
      bsize: 1,
    })),
  };
}

export function successfulLocalCloneExecutor(
  calls,
  {
    cloneIdentity = {},
    dumpContents = "synthetic custom dump",
    sourceIdentity = {},
    scratchDatabaseCount = 0,
    toc = "; archive TOC\n1; 0 0 TABLE public sample postgres\n",
  } = {},
) {
  return vi.fn(async (file, args, options) => {
    calls.push({ args, file, options });
    if (args[0] === "--version") {
      return { stdout: `${file} (PostgreSQL) 17.5\n`, stderr: "" };
    }
    if (file === "pg_dump") {
      const output = args.find((arg) => arg.startsWith("--file=")).slice(7);
      writeFileSync(output, dumpContents, { mode: 0o600 });
    }
    if (file === "pg_restore" && args[0] === "--list") {
      return { stdout: toc, stderr: "" };
    }
    if (file === "psql" && args.some((arg) => arg.includes("count(*)::text"))) {
      return { stdout: `${scratchDatabaseCount}\n`, stderr: "" };
    }
    if (
      file === "psql" &&
      args.some((arg) => arg.includes("json_build_object"))
    ) {
      return {
        stdout: `${JSON.stringify({
          collation: "C.UTF-8",
          ctype: "C.UTF-8",
          database: options.env.PGDATABASE,
          encoding: "UTF8",
          serverMajor: 17,
          user: "postgres",
          ...(options.env.PGDATABASE === "postgres"
            ? sourceIdentity
            : cloneIdentity),
        })}\n`,
        stderr: "",
      };
    }
    if (file === "psql") {
      return { stdout: "inspection-ok\n", stderr: "" };
    }
    return { stdout: "", stderr: "" };
  });
}

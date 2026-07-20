import { describe, expect, it, vi } from "vitest";

import {
  LOCAL_POSTGRES_CLONE_DATABASE,
  parseLocalSupabaseStatus,
} from "../../scripts/local-postgres-clone-contract.mjs";
import {
  LOCAL_SUPABASE_CLI_PATH,
  readLocalSupabaseStatus,
} from "../../scripts/local-postgres-clone-process.mjs";
import {
  LOCAL_CLONE_ENVIRONMENT,
  LOCAL_CLONE_PASSWORD,
  localCloneStatus,
} from "./fixtures/localPostgresCloneFixture.js";

describe("Local Postgres clone target guard", () => {
  it("reads status with the repository-pinned Supabase CLI", async () => {
    const execFileImpl = vi.fn(async () => ({
      stdout: JSON.stringify(localCloneStatus()),
      stderr: "",
    }));
    await expect(readLocalSupabaseStatus(execFileImpl)).resolves.toEqual(
      localCloneStatus(),
    );
    expect(execFileImpl).toHaveBeenCalledWith(
      LOCAL_SUPABASE_CLI_PATH,
      ["status", "--output", "json"],
      expect.objectContaining({
        maxBuffer: expect.any(Number),
        timeout: 30_000,
      }),
    );
    expect(LOCAL_SUPABASE_CLI_PATH).toMatch(
      /\/node_modules\/\.bin\/supabase$/u,
    );
  });

  it("accepts only the exact loopback ports, postgres source, and postgres user", () => {
    const parsed = parseLocalSupabaseStatus(
      localCloneStatus(),
      LOCAL_CLONE_ENVIRONMENT,
    );
    expect(parsed).toMatchObject({
      host: "127.0.0.1",
      port: "56322",
      sourceDatabase: "postgres",
      targetDatabase: LOCAL_POSTGRES_CLONE_DATABASE,
      user: "postgres",
    });
    expect(JSON.stringify({ ...parsed, password: "[redacted]" })).not.toContain(
      LOCAL_CLONE_PASSWORD,
    );
  });

  it.each([
    { API_URL: "http://localhost:56321" },
    { API_URL: "http://127.0.0.1:54321" },
    {
      DB_URL: `postgresql://postgres:${LOCAL_CLONE_PASSWORD}@db.test:56322/postgres`,
    },
    {
      DB_URL: `postgresql://owner:${LOCAL_CLONE_PASSWORD}@127.0.0.1:56322/postgres`,
    },
    {
      DB_URL: `postgresql://postgres:${LOCAL_CLONE_PASSWORD}@127.0.0.1:56322/template1`,
    },
    {
      DB_URL: `postgresql://postgres:${LOCAL_CLONE_PASSWORD}@127.0.0.1:54322/postgres`,
    },
  ])("rejects a non-canonical status target %#", (override) => {
    expect(() =>
      parseLocalSupabaseStatus(
        localCloneStatus(override),
        LOCAL_CLONE_ENVIRONMENT,
      ),
    ).toThrow(/Local Supabase/u);
  });
});

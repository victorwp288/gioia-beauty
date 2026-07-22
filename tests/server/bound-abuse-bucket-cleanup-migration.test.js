import { readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

import {
  validateDatabaseTestSql,
  validateMigrationSql,
} from "../../scripts/check-supabase-sql.mjs";

const MIGRATION_FILE = "20260722090636_bound_abuse_bucket_cleanup.sql";
const PGTAP_FILE = "152_bound_abuse_bucket_cleanup.test.sql";

function repositoryFile(...parts) {
  return readFileSync(path.join(process.cwd(), ...parts), "utf8");
}

describe("bounded abuse-bucket cleanup migration", () => {
  const migration = repositoryFile("supabase", "migrations", MIGRATION_FILE);
  const schema = repositoryFile(
    "supabase",
    "migrations",
    "20260720151757_phase3_durability_security.sql",
  );
  const pgtap = repositoryFile("supabase", "tests", PGTAP_FILE);

  it("passes the repository SQL validators", () => {
    expect(validateMigrationSql(MIGRATION_FILE, migration)).toEqual([]);
    expect(validateDatabaseTestSql(PGTAP_FILE, pgtap)).toEqual([]);
  });

  it("keeps cleanup index-backed, nonblocking, and capped at eight rows", () => {
    expect(schema).toMatch(
      /create index public_abuse_buckets_expiry_idx[\s\S]*\(expires_at, bucket_start\)/u,
    );
    expect(migration).toMatch(
      /where bucket\.expires_at <= v_now[\s\S]*order by bucket\.expires_at, bucket\.bucket_start[\s\S]*limit 8[\s\S]*for update skip locked/u,
    );
    expect(migration).toMatch(
      /delete from gioia_private\.public_abuse_buckets as bucket[\s\S]*using candidates/u,
    );
    expect(migration).not.toMatch(/truncate|drop function/iu);
  });

  it("preserves the existing function identity and security contract", () => {
    expect(migration).toContain(
      "create or replace function gioia_private.consume_public_abuse_bucket(",
    );
    expect(migration).toMatch(
      /language plpgsql\s+volatile\s+security definer\s+set search_path = ''\s+rows 1/u,
    );
    expect(migration).not.toMatch(
      /(?:grant|revoke)[\s\S]{0,120}consume_public_abuse_bucket/iu,
    );
  });
});

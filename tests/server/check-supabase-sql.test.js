import { describe, expect, it } from "vitest";

import {
  validateDatabaseTestSql,
  validateMigrationSql,
} from "../../scripts/check-supabase-sql.mjs";

describe("Supabase SQL static validation", () => {
  it("accepts a bounded transactional private migration", () => {
    expect(
      validateMigrationSql(
        "20260709220000_create_private_table.sql",
        "begin;\ncreate table gioia_private.example (id bigint);\ncommit;\n",
      ),
    ).toEqual([]);
  });

  it("rejects empty, exposed, or oversized migrations", () => {
    expect(validateMigrationSql("bad.sql", "")).toEqual(
      expect.arrayContaining([
        expect.stringContaining("filename"),
        expect.stringContaining("empty"),
      ]),
    );

    const exposed = [
      "begin;",
      "create table public.customers (id bigint);",
      "grant select on public.customers to anon;",
      "commit;",
    ].join("\n");
    expect(
      validateMigrationSql("20260709220001_expose_customers.sql", exposed),
    ).toEqual(
      expect.arrayContaining([
        expect.stringContaining("public schema"),
        expect.stringContaining("Data API roles"),
      ]),
    );

    const oversized = `begin;\n${"select 1;\n".repeat(300)}commit;\n`;
    expect(
      validateMigrationSql("20260709220002_too_large.sql", oversized).some(
        (error) => error.includes("maximum"),
      ),
    ).toBe(true);
  });

  it("requires an empty search path for definer functions", () => {
    const unsafe = [
      "begin;",
      "create function gioia_private.unsafe() returns void",
      "language sql security definer as $$ select null $$;",
      "commit;",
    ].join("\n");
    expect(
      validateMigrationSql("20260709220003_unsafe_function.sql", unsafe).some(
        (error) => error.includes("empty search_path"),
      ),
    ).toBe(true);
  });

  it("rejects the Supabase-incompatible current-user role grant", () => {
    const unsafe = [
      "begin;",
      "grant gioia_mutator to current_user",
      "  with admin false, inherit false, set true;",
      "commit;",
    ].join("\n");

    expect(
      validateMigrationSql("20260709220004_unsafe_role_grant.sql", unsafe).some(
        (error) => error.includes("explicit postgres principal"),
      ),
    ).toBe(true);
  });

  it("requires bounded, planned pgTAP files", () => {
    expect(
      validateDatabaseTestSql(
        "000_schema.test.sql",
        "begin; select plan(1); select ok(true); select * from finish(); rollback;\n",
      ),
    ).toEqual([]);
    expect(validateDatabaseTestSql("schema.sql", "select 1;")).toEqual(
      expect.arrayContaining([
        expect.stringContaining("filename"),
        expect.stringContaining("plan"),
        expect.stringContaining("finish"),
      ]),
    );
  });
});

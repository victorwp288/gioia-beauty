import { describe, expect, it } from "vitest";

import {
  validateDatabaseTestSql,
  validateMigrationSql,
  validateSeedSql,
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

  it("keeps mutator membership through owner-only function ACL changes", () => {
    const unsafe = [
      "begin;",
      "grant gioia_mutator to postgres;",
      "set local role gioia_mutator;",
      "create function gioia_private.example() returns void",
      "language sql as $$ select null $$;",
      "reset role;",
      "revoke gioia_mutator from postgres;",
      "revoke all on function gioia_private.example() from public;",
      "commit;",
    ].join("\n");

    expect(
      validateMigrationSql(
        "20260709220005_early_membership_revoke.sql",
        unsafe,
      ).some((error) => error.includes("function ACL changes")),
    ).toBe(true);
  });

  it("rejects function-style qualification of SQL conditional forms", () => {
    const unsafe = [
      "begin;",
      "select pg_catalog.nullif('value', '');",
      "commit;",
    ].join("\n");

    expect(
      validateMigrationSql(
        "20260709220006_qualified_conditional.sql",
        unsafe,
      ).some((error) => error.includes("SQL conditional forms")),
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

  it("requires transaction-scoped membership for runtime-role tests", () => {
    const unsafe = [
      "begin;",
      "select plan(1);",
      "set local role app_runtime;",
      "select ok(true);",
      "select * from finish();",
      "rollback;",
    ].join("\n");

    expect(
      validateDatabaseTestSql("070_runtime.test.sql", unsafe).some((error) =>
        error.includes("transaction-scoped postgres membership"),
      ),
    ).toBe(true);

    const explicitPostgres17Grant = [
      "begin;",
      "grant app_runtime to postgres with admin false, inherit false, set true granted by current_user;",
      "grant usage on schema extensions to app_runtime;",
      "select plan(1);",
      "set local role app_runtime;",
      "select ok(true);",
      "select * from finish();",
      "rollback;",
    ].join("\n");
    expect(
      validateDatabaseTestSql("070_runtime.test.sql", explicitPostgres17Grant),
    ).toEqual([]);
  });

  it("requires rollback-scoped pgTAP access for restricted-role tests", () => {
    const runtimeWithoutUsage = [
      "begin;",
      "grant app_runtime to postgres;",
      "select plan(1);",
      "set local role app_runtime;",
      "select ok(true);",
      "select * from finish();",
      "rollback;",
    ].join("\n");
    const mutatorWithoutMembership = [
      "begin;",
      "select plan(1);",
      "set local role gioia_mutator;",
      "select ok(true);",
      "select * from finish();",
      "rollback;",
    ].join("\n");

    expect(
      validateDatabaseTestSql("070_runtime.test.sql", runtimeWithoutUsage).some(
        (error) => error.includes("extensions usage"),
      ),
    ).toBe(true);
    expect(
      validateDatabaseTestSql(
        "060_mutator.test.sql",
        mutatorWithoutMembership,
      ).some((error) => error.includes("mutator-role tests")),
    ).toBe(true);
  });

  it("requires database tests to roll back every fixture and temporary grant", () => {
    const committing = [
      "begin;",
      "select plan(1);",
      "select ok(true);",
      "select * from finish();",
      "commit;",
    ].join("\n");

    expect(
      validateDatabaseTestSql("000_committing.test.sql", committing).some(
        (error) => error.includes("roll back"),
      ),
    ).toBe(true);
  });

  it("requires deterministic synthetic-only seed files", () => {
    const safe = [
      "-- Deterministic synthetic fixture.",
      "begin;",
      "insert into auth.users (id, email)",
      "values ('51000000-0000-4000-8000-000000000001', 'owner@gioia.test')",
      "on conflict (id) do update set email = excluded.email;",
      "commit;",
    ].join("\n");
    const unsafe = [
      "begin;",
      "insert into auth.users (email, encrypted_password)",
      "values ('owner@example.com', crypt('plaintext', gen_salt('bf')));",
      "commit;",
    ].join("\n");

    expect(validateSeedSql("00_synthetic.sql", safe)).toEqual([]);
    expect(validateSeedSql("seed.sql", unsafe)).toEqual(
      expect.arrayContaining([
        expect.stringContaining("filename"),
        expect.stringContaining("synthetic"),
        expect.stringContaining("idempotent"),
        expect.stringContaining("fixed test hash"),
        expect.stringContaining("fixed bcrypt test hash"),
        expect.stringContaining("reserved .test"),
      ]),
    );
  });
});

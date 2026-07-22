import { describe, expect, it, vi } from "vitest";

import {
  PrivacyDryRunOperatorError,
  createPrivacyDryRunOperator,
  parsePrivacyDryRunEnvironment,
} from "@/scripts/privacy-dry-run-operator.mjs";

const CASE_ID = "10000000-0000-4000-8000-000000000001";
const SCHEDULE_ID = "20000000-0000-4000-8000-000000000001";
const LOCAL_URL = "postgresql://postgres:postgres@127.0.0.1:54322/postgres";
const REMOTE_URL =
  "postgresql://postgres.hzibzwhrwmljgjjdzspi:private@" +
  "aws-1-eu-central-2.pooler.supabase.com:5432/postgres?sslmode=verify-full";
const STORES = [
  "command_requests",
  "domain_change_log",
  "email_outbox",
  "email_webhook_events",
  "migration_evidence",
  "newsletter_subscribers",
  "owner_auth",
  "schedule_entries",
] as const;

function inventoryRows() {
  return STORES.map((store_name, index) => ({
    store_name,
    matched_rows: index,
    capped: false,
  }));
}

function planRows() {
  return STORES.map((store_name, index) => ({
    store_name,
    matched_rows: index,
    field_codes: ["subject_field"],
    decision_ids: ["RET-01"],
  }));
}

function input() {
  return {
    caseId: CASE_ID,
    policyVersion: "privacy-policy-test-v1",
    requestKind: "erasure",
    normalizedEmail: "subject@example.test",
    clientPhone: "+390000000000",
    scheduleEntryId: SCHEDULE_ID,
    selectorManifestSha256: Buffer.alloc(32, 1),
    identityEvidenceSha256: Buffer.alloc(32, 2),
    identityVerifiedAt: "2035-01-01T12:00:00.000Z",
  } as const;
}

describe("privacy dry-run operator environment", () => {
  it("defaults to dry-run for exact loopback Local/Test", () => {
    expect(
      parsePrivacyDryRunEnvironment(
        { APP_ENV: "local" },
        { getDatabaseUrl: () => LOCAL_URL },
      ),
    ).toEqual({
      mode: "dry-run",
      environment: "local",
      targetId: "gioia-beauty-local",
    });
  });

  it("accepts only the exact protected replacement TEST session pooler", () => {
    expect(
      parsePrivacyDryRunEnvironment(
        {
          APP_ENV: "operator",
          SUPABASE_PROJECT_REF: "hzibzwhrwmljgjjdzspi",
        },
        { getDatabaseUrl: () => REMOTE_URL },
      ),
    ).toEqual({
      mode: "dry-run",
      environment: "test",
      targetId: "hzibzwhrwmljgjjdzspi",
    });
    for (const candidate of [
      { env: { APP_ENV: "production" }, url: LOCAL_URL },
      { env: { APP_ENV: "preview" }, url: LOCAL_URL },
      {
        env: { APP_ENV: "operator", SUPABASE_PROJECT_REF: "wrong" },
        url: REMOTE_URL,
      },
      {
        env: {
          APP_ENV: "operator",
          SUPABASE_PROJECT_REF: "hzibzwhrwmljgjjdzspi",
        },
        url: REMOTE_URL.replace(":5432/", ":6543/"),
      },
    ]) {
      expect(() =>
        parsePrivacyDryRunEnvironment(candidate.env, {
          getDatabaseUrl: () => candidate.url,
        }),
      ).toThrow(PrivacyDryRunOperatorError);
    }
  });

  it("rejects every apply-shaped mode before database work", () => {
    expect(() =>
      parsePrivacyDryRunEnvironment(
        { APP_ENV: "test", PRIVACY_OPERATOR_MODE: "apply" },
        { getDatabaseUrl: () => LOCAL_URL },
      ),
    ).toThrowError("PRIVACY_DRY_RUN_ONLY");
  });
});

describe("privacy dry-run operator", () => {
  it("runs bounded parameterized inventory and returns no selector values", async () => {
    const unsafe = vi.fn(
      async (_query: string, _parameters?: readonly unknown[]) =>
        inventoryRows(),
    );
    const operator = createPrivacyDryRunOperator({
      database: { unsafe },
      env: { APP_ENV: "test", NODE_ENV: "test" },
      getDatabaseUrl: () => LOCAL_URL,
    });
    const result = await operator.inventory(input());

    expect(operator.mode).toBe("dry-run");
    expect("apply" in operator).toBe(false);
    expect(result.inventory).toHaveLength(8);
    expect(Object.isFrozen(result.inventory)).toBe(true);
    expect(JSON.stringify(result)).not.toContain("subject@example.test");
    const [query, parameters] = unsafe.mock.calls[0]!;
    expect(query).not.toContain("subject@example.test");
    expect(query).toContain("inventory_privacy_subject_dry_run");
    expect(parameters).toEqual([
      CASE_ID,
      "privacy-policy-test-v1",
      "test",
      "gioia-beauty-test",
      "erasure",
      "subject@example.test",
      "+390000000000",
      SCHEDULE_ID,
      Buffer.alloc(32, 1),
      Buffer.alloc(32, 2),
      "2035-01-01T12:00:00.000Z",
      100,
    ]);
  });

  it("exposes only a replay-safe dry-run scrub plan", async () => {
    const unsafe = vi.fn(
      async (_query: string, _parameters?: readonly unknown[]) => planRows(),
    );
    const operator = createPrivacyDryRunOperator({
      database: { unsafe },
      env: { APP_ENV: "local", NODE_ENV: "test" },
      getDatabaseUrl: () => LOCAL_URL,
    });
    const result = await operator.planScrub({ caseId: CASE_ID });

    expect(result.mode).toBe("dry-run");
    expect(result.plan).toHaveLength(8);
    expect(unsafe).toHaveBeenCalledWith(
      expect.stringContaining("plan_privacy_scrub_dry_run"),
      [CASE_ID, 10_000],
    );
  });

  it("fails closed on malformed input and database output", async () => {
    const unsafe = vi.fn(
      async (_query: string, _parameters?: readonly unknown[]) =>
        inventoryRows().slice(1),
    );
    const operator = createPrivacyDryRunOperator({
      database: { unsafe },
      env: { APP_ENV: "test", NODE_ENV: "test" },
      getDatabaseUrl: () => LOCAL_URL,
    });
    await expect(operator.inventory(null)).rejects.toThrowError(
      "PRIVACY_INVENTORY_INPUT_INVALID",
    );
    await expect(operator.planScrub(null)).rejects.toThrowError(
      "PRIVACY_SCRUB_PLAN_INPUT_INVALID",
    );
    await expect(
      operator.inventory({ ...input(), normalizedEmail: " Not-Normalized " }),
    ).rejects.toThrowError("PRIVACY_EMAIL_INVALID");
    expect(unsafe).not.toHaveBeenCalled();

    await expect(operator.inventory(input())).rejects.toThrowError(
      "PRIVACY_INVENTORY_RESULT_INVALID",
    );
  });
});

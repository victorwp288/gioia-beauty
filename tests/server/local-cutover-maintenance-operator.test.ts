import { createHash } from "node:crypto";

import { describe, expect, it, vi } from "vitest";

import {
  LocalCutoverOperatorError,
  assertLocalCutoverOperatorEnvironment,
  createLocalCutoverOperator,
} from "@/scripts/local-cutover-maintenance-operator.mjs";

const FREEZE_ID = "10000000-0000-4000-8000-000000000001";
const RUN_ID = "20000000-0000-4000-8000-000000000001";
const GRANT_ID = "30000000-0000-4000-8000-000000000001";
const IDEMPOTENCY_KEY = "40000000-0000-4000-8000-000000000001";
const LOCAL_ENV = {
  NODE_ENV: "test",
  APP_ENV: "test",
  SUPABASE_DATABASE_URL:
    "postgresql://postgres:postgres@127.0.0.1:54322/postgres",
} as const;

describe("local cutover maintenance operator", () => {
  it("accepts only an explicit Local/Test loopback target", () => {
    expect(
      assertLocalCutoverOperatorEnvironment({
        APP_ENV: "local",
        SUPABASE_DATABASE_URL:
          "postgresql://postgres:postgres@127.0.0.1:54322/postgres",
      }),
    ).toBe(true);
    for (const environment of [
      {
        APP_ENV: "preview",
        SUPABASE_DATABASE_URL:
          "postgresql://postgres:secret@127.0.0.1:54322/postgres",
      },
      {
        APP_ENV: "test",
        SUPABASE_DATABASE_URL:
          "postgresql://postgres:secret@pooler.example.test:5432/postgres",
      },
    ]) {
      expect(() => assertLocalCutoverOperatorEnvironment(environment)).toThrow(
        LocalCutoverOperatorError,
      );
    }
  });

  it("keeps raw canary material in memory and sends only its hash to SQL", async () => {
    const unsafe = vi.fn(
      async (query: string, _parameters?: readonly unknown[]) => {
        if (query.includes("begin_cutover_canary_run"))
          return [{ run_id: RUN_ID }];
        return [{ grant_id: GRANT_ID }];
      },
    );
    const operator = createLocalCutoverOperator({
      database: { unsafe },
      env: LOCAL_ENV,
      now: () => new Date("2035-01-01T12:00:00.000Z"),
    });
    await operator.beginCanaryRun({
      freezeId: FREEZE_ID,
      labelCode: "LOCAL_REHEARSAL",
    });
    const fingerprint = Buffer.alloc(32, 9);
    const grant = await operator.issueCanaryGrant({
      runId: RUN_ID,
      operation: "public_booking",
      idempotencyKey: IDEMPOTENCY_KEY,
      requestFingerprint: fingerprint,
    });
    expect(grant.token).toMatch(/^[A-Za-z0-9_-]{43}$/);
    const parameters = unsafe.mock.calls[1]?.[1] as readonly unknown[];
    expect(parameters[1]).toEqual(
      createHash("sha256").update(grant.token).digest(),
    );
    expect(JSON.stringify(parameters)).not.toContain(grant.token);
    expect(parameters[4]).toEqual(fingerprint);
    expect(parameters[4]).not.toBe(fingerprint);
  });

  it("rejects arbitrary canary operations before SQL", async () => {
    const unsafe = vi.fn();
    const operator = createLocalCutoverOperator({
      database: { unsafe },
      env: LOCAL_ENV,
    });
    await expect(
      operator.issueCanaryGrant({
        runId: RUN_ID,
        operation: "owner_delete_everything",
        idempotencyKey: IDEMPOTENCY_KEY,
        requestFingerprint: Buffer.alloc(32),
      }),
    ).rejects.toMatchObject({ code: "INVALID_CANARY_OPERATION" });
    expect(unsafe).not.toHaveBeenCalled();
  });
});

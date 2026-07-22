import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import {
  GREENFIELD_SUPABASE_POOLER_HOST,
  GREENFIELD_SUPABASE_REF,
} from "@/config/environment.mjs";
import {
  LocalTestOutboxRuntimeConfigurationError,
  createLocalTestOutboxRuntime,
} from "@/lib/server/email/localTestOutboxRuntime.ts";

const SECRET = "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA";

function sharedRuntimeEnvironment(
  appEnv: "local" | "test" | "preview",
): Record<string, string | undefined> {
  return {
    APP_ENV: appEnv,
    NEXT_PUBLIC_APP_ENV: appEnv,
    EMAIL_TRANSPORT: "fake",
    EMAIL_WEBHOOK_ENABLED: "false",
    CRON_SECRET: SECRET,
    NEWSLETTER_ACTION_TOKEN_KEYS: JSON.stringify({
      keys: [{ id: "test_1", secret: SECRET }],
    }),
  };
}

function previewEnvironment(
  overrides: Record<string, string | undefined> = {},
): Record<string, string | undefined> {
  return {
    ...sharedRuntimeEnvironment("preview"),
    VERCEL_ENV: "preview",
    SUPABASE_PROJECT_REF: GREENFIELD_SUPABASE_REF,
    NEXT_PUBLIC_SUPABASE_URL: `https://${GREENFIELD_SUPABASE_REF}.supabase.co`,
    NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY:
      "sb_publishable_synthetic_value_123456",
    SUPABASE_DATABASE_URL:
      `postgresql://app_runtime.${GREENFIELD_SUPABASE_REF}:synthetic@` +
      `${GREENFIELD_SUPABASE_POOLER_HOST}:6543/postgres?sslmode=verify-full`,
    BOOKING_HMAC_SECRET: "synthetic-preview-booking-hmac-secret-000000000000",
    OWNER_SESSION_HMAC_SECRET:
      "synthetic-preview-owner-session-secret-000000000000",
    PAGINATION_CURSOR_KEYRING_JSON: JSON.stringify({
      activeKeyId: "preview_1",
      keys: [{ id: "preview_1", secret: SECRET }],
    }),
    ...overrides,
  };
}

describe("non-production TEST outbox runtime", () => {
  it.each(["local", "test"] as const)(
    "preserves the fake %s runtime",
    (appEnv) => {
      const runtime = createLocalTestOutboxRuntime(
        sharedRuntimeEnvironment(appEnv),
      );

      expect(runtime.cronSecret).toBe(SECRET);
      expect(runtime.worker.run).toEqual(expect.any(Function));
    },
  );

  it("allows only the registered TEST project in exact Vercel Preview scope", () => {
    const runtime = createLocalTestOutboxRuntime(previewEnvironment());

    expect(runtime.cronSecret).toBe(SECRET);
    expect(runtime.worker.run).toEqual(expect.any(Function));
  });

  it.each([
    ["wrong project", { SUPABASE_PROJECT_REF: "attacker-project" }],
    [
      "wrong API target",
      { NEXT_PUBLIC_SUPABASE_URL: "https://attacker.supabase.co" },
    ],
    ["wrong Vercel scope", { VERCEL_ENV: "production" }],
    ["real email", { EMAIL_TRANSPORT: "resend" }],
    ["enabled webhook", { EMAIL_WEBHOOK_ENABLED: "true" }],
    ["missing webhook gate", { EMAIL_WEBHOOK_ENABLED: undefined }],
    ["missing Cron secret", { CRON_SECRET: undefined }],
    ["missing token keys", { NEWSLETTER_ACTION_TOKEN_KEYS: undefined }],
  ])("fails closed for Preview with %s", (_name, overrides) => {
    expect(() =>
      createLocalTestOutboxRuntime(previewEnvironment(overrides)),
    ).toThrow(LocalTestOutboxRuntimeConfigurationError);
  });

  it.each([
    {
      APP_ENV: "production",
      NEXT_PUBLIC_APP_ENV: "production",
      VERCEL_ENV: "production",
      EMAIL_TRANSPORT: "fake",
      CRON_SECRET: SECRET,
      NEWSLETTER_ACTION_TOKEN_KEYS: JSON.stringify({
        keys: [{ id: "test_1", secret: SECRET }],
      }),
    },
    {
      APP_ENV: "operator",
      NEXT_PUBLIC_APP_ENV: "operator",
      EMAIL_TRANSPORT: "fake",
      CRON_SECRET: SECRET,
      NEWSLETTER_ACTION_TOKEN_KEYS: JSON.stringify({
        keys: [{ id: "test_1", secret: SECRET }],
      }),
    },
  ])(
    "rejects every non-TEST remote authority without secret reflection",
    (env) => {
      let error: unknown;
      try {
        createLocalTestOutboxRuntime(env);
      } catch (caught) {
        error = caught;
      }

      expect(error).toBeInstanceOf(LocalTestOutboxRuntimeConfigurationError);
      expect(String(error)).not.toContain(SECRET);
      expect(String(error)).not.toContain(GREENFIELD_SUPABASE_REF);
    },
  );
});

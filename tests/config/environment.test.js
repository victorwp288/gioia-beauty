import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";

import {
  GREENFIELD_SUPABASE_POOLER_HOST,
  GREENFIELD_SUPABASE_REF,
  validateEnvironment,
} from "@/config/environment.mjs";

function validate(overrides = {}, command = "application") {
  const env = { APP_ENV: "local", EMAIL_TRANSPORT: "fake", ...overrides };
  env.NEXT_PUBLIC_APP_ENV ??= env.APP_ENV;
  return validateEnvironment(env, { command });
}

function previewEnvironment(overrides = {}) {
  return {
    APP_ENV: "preview",
    VERCEL_ENV: "preview",
    SUPABASE_PROJECT_REF: GREENFIELD_SUPABASE_REF,
    NEXT_PUBLIC_SUPABASE_URL: `https://${GREENFIELD_SUPABASE_REF}.supabase.co`,
    NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY:
      "sb_publishable_synthetic_value_123456",
    SUPABASE_DATABASE_URL:
      `postgresql://app_runtime.${GREENFIELD_SUPABASE_REF}:` +
      `synthetic@${GREENFIELD_SUPABASE_POOLER_HOST}:6543/postgres` +
      "?sslmode=verify-full",
    BOOKING_HMAC_SECRET: "synthetic-preview-booking-hmac-secret-000000000000",
    OWNER_SESSION_HMAC_SECRET:
      "synthetic-preview-owner-session-secret-000000000000",
    PAGINATION_CURSOR_KEYRING_JSON: JSON.stringify({
      activeKeyId: "preview_1",
      keys: [
        {
          id: "preview_1",
          secret: "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA",
        },
      ],
    }),
    ...overrides,
  };
}

const TURNSTILE_PREVIEW_ENVIRONMENT = Object.freeze({
  PUBLIC_HUMAN_CHALLENGE_PROVIDER: "turnstile",
  NEXT_PUBLIC_TURNSTILE_SITE_KEY: "1x00000000000000000000AA",
  TURNSTILE_SECRET_KEY: "1x0000000000000000000000000000000AA",
  TURNSTILE_ALLOWED_HOSTNAMES_JSON: JSON.stringify([
    "gioia-beauty-git-refactor.example.vercel.app",
  ]),
});

describe("environment isolation", () => {
  it("accepts a minimal local environment", () => {
    expect(validate()).toEqual({ ok: true, appEnv: "local", errors: [] });
  });

  it("allows only the local structured-console observability transport", () => {
    expect(validate({ OBSERVABILITY_TRANSPORT: "console" }).ok).toBe(true);
    for (const transport of ["", "sentry", "otlp", "https://example.test"]) {
      expect(validate({ OBSERVABILITY_TRANSPORT: transport }).errors).toContain(
        "OBSERVABILITY_TRANSPORT must be console when configured",
      );
    }
  });

  it.each([
    "SENTRY_DSN",
    "SENTRY_AUTH_TOKEN",
    "SENTRY_ORG",
    "SENTRY_PROJECT",
    "SENTRY_RELEASE",
    "NEXT_PUBLIC_SENTRY_DSN",
  ])("rejects unregistered Sentry variable %s in every environment", (key) => {
    for (const environment of [
      { APP_ENV: "local" },
      { APP_ENV: "test" },
      previewEnvironment(),
      {
        APP_ENV: "production",
        VERCEL_ENV: "production",
        GIOIA_PRODUCTION_APPROVAL_ID: "synthetic-approval",
      },
      { APP_ENV: "operator" },
    ]) {
      const result = validate({ ...environment, [key]: "synthetic-value" });
      expect(result.errors).toContain(
        `${key} is forbidden until a Sentry target is registered`,
      );
    }
  });

  it("keeps Production and operator startup disabled with console metrics", () => {
    const production = validate({
      APP_ENV: "production",
      VERCEL_ENV: "production",
      GIOIA_PRODUCTION_APPROVAL_ID: "synthetic-approval",
      OBSERVABILITY_TRANSPORT: "console",
    });
    const operator = validate({
      APP_ENV: "operator",
      OBSERVABILITY_TRANSPORT: "console",
    });

    expect(production.errors.join(" ")).toContain(
      "No Supabase Production target is registered",
    );
    expect(operator.errors).toContain(
      "The protected operator environment cannot start the application",
    );
  });

  it("requires the non-delivering transport outside Production", () => {
    expect(validate({ EMAIL_TRANSPORT: "resend" }).errors).toContain(
      "EMAIL_TRANSPORT must be fake in local",
    );
  });

  it("requires the public environment marker to match the server marker", () => {
    expect(
      validateEnvironment({
        APP_ENV: "local",
        NEXT_PUBLIC_APP_ENV: "test",
        EMAIL_TRANSPORT: "fake",
      }).ok,
    ).toBe(false);
    expect(
      validateEnvironment({ APP_ENV: "local", EMAIL_TRANSPORT: "fake" }).errors,
    ).toContain("NEXT_PUBLIC_APP_ENV is required by the browser runtime");
  });

  it.each([
    "gioia-beauty-b95e0",
    "clinic-418813",
    "gioia-beauty",
    "gioia-beauty-2d043",
  ])("rejects remote Firebase target %s outside Production", (projectId) => {
    const result = validate({ NEXT_PUBLIC_FIREBASE_PROJECT_ID: projectId });

    expect(result.ok).toBe(false);
    expect(result.errors.join(" ")).toContain(
      "forbidden remote Firebase project",
    );
  });

  it("rejects cloud database URLs in Local and CI", () => {
    const result = validate({
      APP_ENV: "test",
      SUPABASE_DATABASE_URL:
        "postgresql://synthetic.invalid@aws-0-eu-central-2.pooler.supabase.com:6543/postgres",
    });

    expect(result.ok).toBe(false);
    expect(result.errors).toContain(
      "SUPABASE_DATABASE_URL must resolve to loopback in test",
    );
  });

  it("rejects provider and service-account credentials outside Production", () => {
    const result = validate({
      RESEND_API_KEY: "synthetic-not-a-real-key",
      RESEND_WEBHOOK_SECRET: `whsec_${"a".repeat(44)}`,
      GOOGLE_APPLICATION_CREDENTIALS: "/tmp/service-account.json",
    });

    expect(result.ok).toBe(false);
    expect(result.errors).toContain("RESEND_API_KEY is forbidden in local");
    expect(result.errors).toContain(
      "RESEND_WEBHOOK_SECRET is forbidden in local",
    );
    expect(result.errors).toContain(
      "GOOGLE_APPLICATION_CREDENTIALS is forbidden in local",
    );
  });

  it("keeps provider webhooks disabled outside Production", () => {
    expect(validate({ EMAIL_WEBHOOK_ENABLED: "true" }).errors).toContain(
      "EMAIL_WEBHOOK_ENABLED must not enable webhooks in local",
    );
    expect(validate({ EMAIL_WEBHOOK_ENABLED: "sometimes" }).errors).toContain(
      "EMAIL_WEBHOOK_ENABLED must be true or false",
    );
  });

  it("rejects secrets placed in browser-exposed variables", () => {
    const result = validate({
      NEXT_PUBLIC_SUPABASE_SERVICE_ROLE_KEY: "synthetic-not-a-real-key",
    });

    expect(result.ok).toBe(false);
    expect(result.errors[0]).toContain("must never be exposed to the browser");
  });

  it("requires strong server-only booking HMAC material remotely", () => {
    const missing = previewEnvironment({ BOOKING_HMAC_SECRET: undefined });
    const short = previewEnvironment({ BOOKING_HMAC_SECRET: "too-short" });

    expect(validate(missing).errors).toContain(
      "preview requires BOOKING_HMAC_SECRET",
    );
    expect(validate(short).errors).toContain(
      "BOOKING_HMAC_SECRET must contain at least 32 bytes",
    );
  });

  it("rejects an explicitly empty local booking HMAC secret", () => {
    expect(validate({ BOOKING_HMAC_SECRET: "" }).errors).toContain(
      "BOOKING_HMAC_SECRET must contain at least 32 bytes",
    );
  });

  it("requires strong server-only owner session binding material remotely", () => {
    const missing = previewEnvironment({
      OWNER_SESSION_HMAC_SECRET: undefined,
    });
    const short = previewEnvironment({
      OWNER_SESSION_HMAC_SECRET: "too-short",
    });

    expect(validate(missing).errors).toContain(
      "preview requires OWNER_SESSION_HMAC_SECRET",
    );
    expect(validate(short).errors).toContain(
      "OWNER_SESSION_HMAC_SECRET must contain at least 32 bytes",
    );
  });

  it("requires an exact server-only pagination cursor keyring remotely", () => {
    const missing = previewEnvironment({
      PAGINATION_CURSOR_KEYRING_JSON: undefined,
    });
    const malformed = previewEnvironment({
      PAGINATION_CURSOR_KEYRING_JSON: JSON.stringify({
        activeKeyId: "preview_1",
        keys: [{ id: "preview_1", secret: "too-short" }],
      }),
    });

    expect(validate(missing).errors).toContain(
      "preview requires PAGINATION_CURSOR_KEYRING_JSON",
    );
    expect(validate(malformed).errors).toContain(
      "PAGINATION_CURSOR_KEYRING_JSON is invalid",
    );
  });

  it("allows only a canonical Local/Test human-challenge fake token", () => {
    const token = "A".repeat(43);
    expect(
      validate({
        APP_ENV: "test",
        NEXT_PUBLIC_APP_ENV: "test",
        EMAIL_TRANSPORT: "fake",
        PUBLIC_HUMAN_CHALLENGE_TEST_TOKEN: token,
      }).ok,
    ).toBe(true);
    expect(
      validate({
        APP_ENV: "test",
        NEXT_PUBLIC_APP_ENV: "test",
        EMAIL_TRANSPORT: "fake",
        PUBLIC_HUMAN_CHALLENGE_TEST_TOKEN: "not-canonical",
      }).errors,
    ).toContain("PUBLIC_HUMAN_CHALLENGE_TEST_TOKEN is invalid");
    expect(
      validate(previewEnvironment({ PUBLIC_HUMAN_CHALLENGE_TEST_TOKEN: token }))
        .errors,
    ).toContain("PUBLIC_HUMAN_CHALLENGE_TEST_TOKEN is forbidden in preview");
  });

  it("accepts only a complete exact-host Turnstile bundle in Preview", () => {
    expect(validate(previewEnvironment(TURNSTILE_PREVIEW_ENVIRONMENT))).toEqual(
      { ok: true, appEnv: "preview", errors: [] },
    );

    for (const key of Object.keys(TURNSTILE_PREVIEW_ENVIRONMENT)) {
      const incomplete = { ...TURNSTILE_PREVIEW_ENVIRONMENT, [key]: undefined };
      expect(validate(previewEnvironment(incomplete)).errors, key).toContain(
        "Preview Turnstile configuration is incomplete or invalid",
      );
    }
  });

  it.each([
    ["uppercase", ["Preview.Example.vercel.app"]],
    ["URL", ["https://preview.example.vercel.app"]],
    ["wildcard", ["*.example.vercel.app"]],
    ["duplicate", ["preview.example.test", "preview.example.test"]],
    ["empty", []],
  ])("rejects %s Turnstile hostname configuration", (_label, hostnames) => {
    const result = validate(
      previewEnvironment({
        ...TURNSTILE_PREVIEW_ENVIRONMENT,
        TURNSTILE_ALLOWED_HOSTNAMES_JSON: JSON.stringify(hostnames),
      }),
    );
    expect(result.errors).toContain(
      "Preview Turnstile configuration is incomplete or invalid",
    );
  });

  it("forbids the remote Turnstile credential bundle outside Preview", () => {
    for (const appEnv of ["local", "test", "operator"]) {
      const result = validate({
        APP_ENV: appEnv,
        NEXT_PUBLIC_APP_ENV: appEnv,
        ...TURNSTILE_PREVIEW_ENVIRONMENT,
      });
      expect(result.errors).toContain(
        `Turnstile configuration is forbidden in ${appEnv}`,
      );
    }
  });

  it("allows Preview only with the registered greenfield Supabase ref", () => {
    const accepted = validate(previewEnvironment());
    const rejected = validate({
      APP_ENV: "preview",
      VERCEL_ENV: "preview",
      SUPABASE_PROJECT_REF: "wrong-project-ref",
      NEXT_PUBLIC_SUPABASE_URL: "https://wrong-project-ref.supabase.co",
    });

    expect(accepted.ok).toBe(true);
    expect(rejected.ok).toBe(false);
  });

  it.each([
    ["legacy carrier", `app_runtime_login.${GREENFIELD_SUPABASE_REF}`],
    ["privileged role", `postgres.${GREENFIELD_SUPABASE_REF}`],
    ["other role", `other.${GREENFIELD_SUPABASE_REF}`],
  ])("rejects the %s as a Preview database login", (_, username) => {
    const result = validate(
      previewEnvironment({
        SUPABASE_DATABASE_URL:
          `postgresql://${username}:synthetic@` +
          `${GREENFIELD_SUPABASE_POOLER_HOST}:6543/postgres` +
          "?sslmode=verify-full",
      }),
    );

    expect(result.ok).toBe(false);
    expect(result.errors.join(" ")).toContain(
      "app_runtime login through the exact transaction pooler",
    );
  });

  it.each([
    [
      "direct connection",
      `postgresql://app_runtime:synthetic@db.${GREENFIELD_SUPABASE_REF}.supabase.co:5432/postgres?sslmode=verify-full`,
    ],
    [
      "session pooler",
      `postgresql://app_runtime.${GREENFIELD_SUPABASE_REF}:synthetic@${GREENFIELD_SUPABASE_POOLER_HOST}:5432/postgres?sslmode=verify-full`,
    ],
    [
      "wrong transaction pooler",
      `postgresql://app_runtime.${GREENFIELD_SUPABASE_REF}:synthetic@aws-0-eu-central-2.pooler.supabase.com:6543/postgres?sslmode=verify-full`,
    ],
    [
      "missing verify-full",
      `postgresql://app_runtime.${GREENFIELD_SUPABASE_REF}:synthetic@${GREENFIELD_SUPABASE_POOLER_HOST}:6543/postgres`,
    ],
    [
      "weaker TLS mode",
      `postgresql://app_runtime.${GREENFIELD_SUPABASE_REF}:synthetic@${GREENFIELD_SUPABASE_POOLER_HOST}:6543/postgres?sslmode=require`,
    ],
  ])("rejects a Preview %s URL", (_, databaseUrl) => {
    const result = validate(
      previewEnvironment({ SUPABASE_DATABASE_URL: databaseUrl }),
    );

    expect(result.ok).toBe(false);
    expect(result.errors.join(" ")).toContain("transaction pooler");
  });

  it("binds Preview URLs to the registered project ref", () => {
    const result = validate(
      previewEnvironment({
        NEXT_PUBLIC_SUPABASE_URL: "https://attacker-project.supabase.co",
      }),
    );

    expect(result.ok).toBe(false);
    expect(result.errors.join(" ")).toContain("does not match");
  });

  it("requires exact Vercel scope and a separate Production approval id", () => {
    const previewMismatch = validate({ APP_ENV: "preview" });
    const production = validate({
      APP_ENV: "production",
      VERCEL_ENV: "production",
      SUPABASE_PROJECT_REF: GREENFIELD_SUPABASE_REF,
      NEXT_PUBLIC_SUPABASE_URL: `https://${GREENFIELD_SUPABASE_REF}.supabase.co`,
    });

    expect(previewMismatch.ok).toBe(false);
    expect(production.ok).toBe(false);
    expect(production.errors).toContain(
      "Production application commands require GIOIA_PRODUCTION_APPROVAL_ID",
    );
  });

  it("requires a server-only Resend credential in Production", () => {
    const missing = validate({
      APP_ENV: "production",
      VERCEL_ENV: "production",
      EMAIL_TRANSPORT: "resend",
      GIOIA_PRODUCTION_APPROVAL_ID: "synthetic-approval",
    });
    const malformed = validate({
      APP_ENV: "production",
      VERCEL_ENV: "production",
      EMAIL_TRANSPORT: "resend",
      EMAIL_WEBHOOK_ENABLED: "true",
      RESEND_API_KEY: "synthetic-invalid",
      RESEND_WEBHOOK_SECRET: "whsec_invalid",
      GIOIA_PRODUCTION_APPROVAL_ID: "synthetic-approval",
    });

    expect(missing.errors).toContain("Production requires RESEND_API_KEY");
    expect(missing.errors).toContain(
      "Production requires EMAIL_WEBHOOK_ENABLED=true",
    );
    expect(missing.errors).toContain(
      "Production requires RESEND_WEBHOOK_SECRET",
    );
    expect(malformed.errors).toContain("RESEND_API_KEY has an invalid format");
    expect(malformed.errors).toContain(
      "RESEND_WEBHOOK_SECRET has an invalid format",
    );
  });

  it("rejects arbitrary Production targets and every Firebase emulator variable", () => {
    const wrongTarget = validate({
      APP_ENV: "production",
      VERCEL_ENV: "production",
      GIOIA_PRODUCTION_APPROVAL_ID: "synthetic-approval",
      SUPABASE_PROJECT_REF: "attacker-project",
      NEXT_PUBLIC_SUPABASE_URL: "https://attacker-project.supabase.co",
    });
    const emulator = validate({
      APP_ENV: "production",
      VERCEL_ENV: "production",
      GIOIA_PRODUCTION_APPROVAL_ID: "synthetic-approval",
      SUPABASE_PROJECT_REF: GREENFIELD_SUPABASE_REF,
      NEXT_PUBLIC_SUPABASE_URL: `https://${GREENFIELD_SUPABASE_REF}.supabase.co`,
      FIREBASE_AUTH_EMULATOR_HOST: "127.0.0.1:9099",
      FIRESTORE_EMULATOR_HOST: "127.0.0.1:8080",
      GOOGLE_APPLICATION_CREDENTIALS: "/tmp/synthetic-service-account.json",
    });

    expect(wrongTarget.ok).toBe(false);
    expect(emulator.ok).toBe(false);
    expect(emulator.errors.join(" ")).toContain("Firebase-free Production");
    expect(wrongTarget.errors.join(" ")).toContain(
      "No Supabase Production target is registered",
    );
  });

  it("rejects arbitrary Firebase Admin targets or missing emulator isolation", () => {
    const arbitrary = validate({
      FIREBASE_ADMIN_PROJECT_ID: "other-remote-project",
    });
    const missingEmulator = validate({
      FIREBASE_ADMIN_PROJECT_ID: "demo-gioia-beauty",
    });

    expect(arbitrary.ok).toBe(false);
    expect(missingEmulator.ok).toBe(false);
  });

  it("allows the committed local environment example", () => {
    const example = Object.fromEntries(
      readFileSync(".env.example", "utf8")
        .split(/\r?\n/)
        .filter((line) => line && !line.startsWith("#"))
        .map((line) => {
          const separator = line.indexOf("=");
          return [line.slice(0, separator), line.slice(separator + 1)];
        }),
    );

    expect(validateEnvironment(example)).toEqual({
      ok: true,
      appEnv: "local",
      errors: [],
    });
  });

  it("allows tests only in the explicit Test environment", () => {
    expect(
      validateEnvironment(
        {
          APP_ENV: "test",
          NEXT_PUBLIC_APP_ENV: "test",
          EMAIL_TRANSPORT: "fake",
        },
        { command: "test" },
      ).ok,
    ).toBe(true);
    expect(
      validateEnvironment(
        {
          APP_ENV: "operator",
          NEXT_PUBLIC_APP_ENV: "operator",
          EMAIL_TRANSPORT: "fake",
        },
        { command: "test" },
      ).ok,
    ).toBe(false);
    expect(
      validateEnvironment(
        {
          APP_ENV: "production",
          NEXT_PUBLIC_APP_ENV: "production",
          VERCEL_ENV: "production",
          GIOIA_PRODUCTION_APPROVAL_ID: "synthetic-approval",
          SUPABASE_PROJECT_REF: GREENFIELD_SUPABASE_REF,
          NEXT_PUBLIC_SUPABASE_URL: `https://${GREENFIELD_SUPABASE_REF}.supabase.co`,
        },
        { command: "test" },
      ).ok,
    ).toBe(false);
  });

  it("prevents the operator environment from starting the application", () => {
    const result = validate({ APP_ENV: "operator" });

    expect(result.ok).toBe(false);
    expect(result.errors).toContain(
      "The protected operator environment cannot start the application",
    );
  });
});

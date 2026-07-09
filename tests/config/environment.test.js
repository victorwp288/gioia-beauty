import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";

import {
  GREENFIELD_SUPABASE_REF,
  validateEnvironment,
} from "@/config/environment.mjs";

function validate(overrides = {}, command = "application") {
  return validateEnvironment({ APP_ENV: "local", ...overrides }, { command });
}

describe("environment isolation", () => {
  it("accepts a minimal local environment", () => {
    expect(validate()).toEqual({ ok: true, appEnv: "local", errors: [] });
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
      GOOGLE_APPLICATION_CREDENTIALS: "/tmp/service-account.json",
    });

    expect(result.ok).toBe(false);
    expect(result.errors).toContain("RESEND_API_KEY is forbidden in local");
    expect(result.errors).toContain(
      "GOOGLE_APPLICATION_CREDENTIALS is forbidden in local",
    );
  });

  it("rejects secrets placed in browser-exposed variables", () => {
    const result = validate({
      NEXT_PUBLIC_SUPABASE_SERVICE_ROLE_KEY: "synthetic-not-a-real-key",
    });

    expect(result.ok).toBe(false);
    expect(result.errors[0]).toContain("must never be exposed to the browser");
  });

  it("allows Preview only with the registered greenfield Supabase ref", () => {
    const accepted = validate({
      APP_ENV: "preview",
      VERCEL_ENV: "preview",
      SUPABASE_PROJECT_REF: GREENFIELD_SUPABASE_REF,
      NEXT_PUBLIC_SUPABASE_URL: `https://${GREENFIELD_SUPABASE_REF}.supabase.co`,
    });
    const rejected = validate({
      APP_ENV: "preview",
      VERCEL_ENV: "preview",
      SUPABASE_PROJECT_REF: "wrong-project-ref",
      NEXT_PUBLIC_SUPABASE_URL: "https://wrong-project-ref.supabase.co",
    });

    expect(accepted.ok).toBe(true);
    expect(rejected.ok).toBe(false);
  });

  it("binds Preview URLs to the registered project ref", () => {
    const result = validate({
      APP_ENV: "preview",
      VERCEL_ENV: "preview",
      SUPABASE_PROJECT_REF: GREENFIELD_SUPABASE_REF,
      NEXT_PUBLIC_SUPABASE_URL: "https://attacker-project.supabase.co",
    });

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
      validateEnvironment({ APP_ENV: "test" }, { command: "test" }).ok,
    ).toBe(true);
    expect(
      validateEnvironment({ APP_ENV: "operator" }, { command: "test" }).ok,
    ).toBe(false);
    expect(
      validateEnvironment(
        {
          APP_ENV: "production",
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

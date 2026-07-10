import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import {
  LOCAL_DISABLED_SIGNUP_PROBE,
  LOCAL_SYNTHETIC_OWNER,
  parseLocalAuthStatus,
} from "../../scripts/test-local-auth-seed.mjs";

describe("local synthetic Auth seed smoke test", () => {
  it("exports one visibly synthetic local-only login fixture", () => {
    expect(LOCAL_SYNTHETIC_OWNER.id).toBe(
      "51000000-0000-4000-8000-000000000001",
    );
    expect(LOCAL_SYNTHETIC_OWNER.email.endsWith(".test")).toBe(true);
    expect(LOCAL_SYNTHETIC_OWNER.password.length).toBeGreaterThanOrEqual(12);
    expect(LOCAL_DISABLED_SIGNUP_PROBE.email.endsWith(".test")).toBe(true);
    expect(LOCAL_DISABLED_SIGNUP_PROBE.email).not.toBe(
      LOCAL_SYNTHETIC_OWNER.email,
    );
    expect(LOCAL_DISABLED_SIGNUP_PROBE.password.length).toBeGreaterThanOrEqual(
      12,
    );
  });

  it("uses the current capture-only local SMTP configuration", () => {
    const config = readFileSync(
      new URL("../../supabase/config.toml", import.meta.url),
      "utf8",
    );

    expect(config).toContain("[local_smtp]");
    expect(config).toContain('admin_email = "owner.local@gioia.test"');
    expect(config).not.toContain("[inbucket]");
  });

  it("enables email login without enabling public local signups", () => {
    const config = readFileSync(
      new URL("../../supabase/config.toml", import.meta.url),
      "utf8",
    );
    const authSection = config.match(/\[auth\]\n([\s\S]*?)(?=\n\[)/u)?.[1];
    const emailSection = config.match(
      /\[auth\.email\]\n([\s\S]*?)(?=\n\[)/u,
    )?.[1];

    expect(authSection).toContain("enable_signup = false");
    expect(emailSection).toContain("enable_signup = true");
  });

  it("accepts current opaque and legacy local publishable keys", () => {
    expect(
      parseLocalAuthStatus({
        API_URL: "http://127.0.0.1:54321",
        PUBLISHABLE_KEY: "sb_publishable_local_fixture_key",
      }),
    ).toMatchObject({
      apiUrl: new URL("http://127.0.0.1:54321"),
      publishableKey: "sb_publishable_local_fixture_key",
    });

    expect(
      parseLocalAuthStatus({
        API_URL: "http://localhost:54321/",
        ANON_KEY: "local.legacy.jwt.fixture",
      }).publishableKey,
    ).toBe("local.legacy.jwt.fixture");
  });

  it("rejects remote, malformed, or keyless status output", () => {
    expect(() =>
      parseLocalAuthStatus({
        API_URL: "https://example.test:54321",
        PUBLISHABLE_KEY: "sb_publishable_remote_fixture_key",
      }),
    ).toThrow("safe local Auth URL");
    expect(() =>
      parseLocalAuthStatus({
        API_URL: "http://127.0.0.1:54321",
      }),
    ).toThrow("local publishable key");
    expect(() => parseLocalAuthStatus(null)).toThrow("must be an object");
  });
});

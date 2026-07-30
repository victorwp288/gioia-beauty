import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { readProviderConfiguration } from "@/lib/server/observability/providerConfiguration.ts";

const VALID_ENVIRONMENT = Object.freeze({
  APP_ENV: "preview",
  VERCEL_GIT_COMMIT_SHA: "a".repeat(40),
  SENTRY_DSN: "https://0123456789abcdef@o123456.ingest.de.sentry.io/1234567",
  POSTHOG_PROJECT_TOKEN: "phc_0123456789abcdefghijklmnop",
  POSTHOG_HOST: "https://eu.i.posthog.com",
});

describe("observability provider configuration", () => {
  it("derives an immutable release without a branch-specific code path", () => {
    expect(readProviderConfiguration(VALID_ENVIRONMENT)).toEqual({
      environment: "preview",
      release: `gioia-beauty@${"a".repeat(40)}`,
      sentryDsn: VALID_ENVIRONMENT.SENTRY_DSN,
      posthogProjectToken: VALID_ENVIRONMENT.POSTHOG_PROJECT_TOKEN,
      posthogHost: "https://eu.i.posthog.com",
    });
    expect(
      readProviderConfiguration({
        ...VALID_ENVIRONMENT,
        APP_ENV: "production",
      }),
    ).toMatchObject({ environment: "production" });
  });

  it.each([
    {
      APP_ENV: undefined,
      VERCEL_GIT_COMMIT_SHA: undefined,
      SENTRY_DSN: undefined,
      POSTHOG_PROJECT_TOKEN: undefined,
      POSTHOG_HOST: undefined,
    },
    { APP_ENV: "local" },
    { POSTHOG_HOST: "https://us.i.posthog.com" },
    {
      SENTRY_DSN: "https://0123456789abcdef@o123456.ingest.sentry.io/1234567",
    },
    { POSTHOG_PROJECT_TOKEN: "phx_personal-secret" },
    { VERCEL_GIT_COMMIT_SHA: "preview" },
  ])("fails closed for absent, partial, or invalid input %#", (override) => {
    expect(
      readProviderConfiguration({ ...VALID_ENVIRONMENT, ...override }),
    ).toBeNull();
  });

  it("does not invoke environment accessors or proxies beyond the fail-closed boundary", () => {
    const accessor = {
      ...VALID_ENVIRONMENT,
      get SENTRY_DSN(): string {
        throw new Error("must not escape");
      },
    };
    const revoked = Proxy.revocable({ ...VALID_ENVIRONMENT }, {});
    revoked.revoke();

    expect(readProviderConfiguration(accessor)).toBeNull();
    expect(readProviderConfiguration(revoked.proxy)).toBeNull();
  });
});

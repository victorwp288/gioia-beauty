import "server-only";

const EU_POSTHOG_HOST = "https://eu.i.posthog.com";
const COMMIT_SHA_PATTERN = /^[0-9a-f]{40}$/;
const POSTHOG_PROJECT_TOKEN_PATTERN = /^phc_[A-Za-z0-9_-]{20,}$/;

export interface ProviderConfiguration {
  readonly environment: "preview" | "production";
  readonly release: string;
  readonly sentryDsn: string;
  readonly posthogProjectToken: string;
  readonly posthogHost: typeof EU_POSTHOG_HOST;
}

function hasExactSentryEuDsn(value: string | undefined): value is string {
  if (!value || value.trim() !== value) return false;
  try {
    const url = new URL(value);
    return (
      url.protocol === "https:" &&
      url.username.length > 0 &&
      url.password === "" &&
      url.port === "" &&
      /(?:^|\.)ingest\.de\.sentry\.io$/.test(url.hostname) &&
      /^\/[0-9]+$/.test(url.pathname) &&
      url.search === "" &&
      url.hash === ""
    );
  } catch {
    return false;
  }
}

export function readProviderConfiguration(
  environment: Readonly<Record<string, string | undefined>> = process.env,
): ProviderConfiguration | null {
  try {
    const appEnvironment = environment.APP_ENV;
    const commitSha = environment.VERCEL_GIT_COMMIT_SHA;
    const sentryDsn = environment.SENTRY_DSN;
    const posthogProjectToken = environment.POSTHOG_PROJECT_TOKEN;
    const posthogHost = environment.POSTHOG_HOST;

    if (
      (appEnvironment !== "preview" && appEnvironment !== "production") ||
      !commitSha ||
      !COMMIT_SHA_PATTERN.test(commitSha) ||
      !hasExactSentryEuDsn(sentryDsn) ||
      !posthogProjectToken ||
      !POSTHOG_PROJECT_TOKEN_PATTERN.test(posthogProjectToken) ||
      posthogHost !== EU_POSTHOG_HOST
    ) {
      return null;
    }

    return Object.freeze({
      environment: appEnvironment,
      release: `gioia-beauty@${commitSha}`,
      sentryDsn,
      posthogProjectToken,
      posthogHost,
    });
  } catch {
    return null;
  }
}

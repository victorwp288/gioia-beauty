import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const providerMocks = vi.hoisted(() => ({
  afterCallbacks: [] as Array<() => Promise<void>>,
  after: vi.fn(),
  initSentry: vi.fn(),
  captureException: vi.fn(),
  flush: vi.fn(),
  sentryScopes: [] as Array<{
    tags: Record<string, string>;
    extra: Record<string, unknown>;
  }>,
  posthogConstructors: [] as Array<{
    token: string;
    options: Record<string, unknown>;
  }>,
  captureImmediate: vi.fn(),
}));

vi.mock("server-only", () => ({}));
vi.mock("next/server", () => ({
  after: providerMocks.after,
}));
vi.mock("@sentry/node", () => {
  class Scope {
    readonly state = {
      tags: {} as Record<string, string>,
      extra: {} as Record<string, unknown>,
    };

    constructor() {
      providerMocks.sentryScopes.push(this.state);
    }

    setTags(tags: Record<string, string>): void {
      Object.assign(this.state.tags, tags);
    }

    setExtra(key: string, value: unknown): void {
      this.state.extra[key] = value;
    }
  }

  return {
    Scope,
    initWithoutDefaultIntegrations: providerMocks.initSentry,
  };
});
vi.mock("posthog-node", () => ({
  PostHog: class {
    constructor(token: string, options: Record<string, unknown>) {
      providerMocks.posthogConstructors.push({ token, options });
    }

    captureImmediate(input: unknown): Promise<void> {
      return providerMocks.captureImmediate(input);
    }
  },
}));

const ORIGINAL_ENVIRONMENT = {
  APP_ENV: process.env.APP_ENV,
  VERCEL_GIT_COMMIT_SHA: process.env.VERCEL_GIT_COMMIT_SHA,
  SENTRY_DSN: process.env.SENTRY_DSN,
  POSTHOG_PROJECT_TOKEN: process.env.POSTHOG_PROJECT_TOKEN,
  POSTHOG_HOST: process.env.POSTHOG_HOST,
};

const REQUEST_ID = "123e4567-e89b-42d3-a456-426614174000";
const RELEASE = `gioia-beauty@${"a".repeat(40)}`;

function setValidEnvironment(): void {
  process.env.APP_ENV = "preview";
  process.env.VERCEL_GIT_COMMIT_SHA = "a".repeat(40);
  process.env.SENTRY_DSN =
    "https://0123456789abcdef@o123456.ingest.de.sentry.io/1234567";
  process.env.POSTHOG_PROJECT_TOKEN = "phc_0123456789abcdefghijklmnop";
  process.env.POSTHOG_HOST = "https://eu.i.posthog.com";
}

function routeLine(status = 503): string {
  return `${JSON.stringify({
    v: 1,
    ts: "2026-07-30T12:00:00.000Z",
    event: "route_completed",
    route: "public.booking",
    method: "POST",
    requestId: REQUEST_ID,
    status,
    outcome: status >= 500 ? "server_error" : "success",
    durationMs: 17,
  })}\n`;
}

async function loadProviderRuntime() {
  return import("@/lib/server/observability/providerRuntime.ts");
}

beforeEach(() => {
  vi.resetModules();
  vi.clearAllMocks();
  providerMocks.afterCallbacks.length = 0;
  providerMocks.sentryScopes.length = 0;
  providerMocks.posthogConstructors.length = 0;
  setValidEnvironment();
  providerMocks.after.mockImplementation((callback: () => Promise<void>) => {
    providerMocks.afterCallbacks.push(callback);
  });
  providerMocks.initSentry.mockReturnValue({
    captureException: providerMocks.captureException,
    flush: providerMocks.flush,
  });
  providerMocks.captureImmediate.mockResolvedValue(undefined);
  providerMocks.flush.mockResolvedValue(true);
});

afterEach(() => {
  for (const [key, value] of Object.entries(ORIGINAL_ENVIRONMENT)) {
    if (value === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = value;
    }
  }
});

describe("server observability providers", () => {
  it("sends one exact personless PostHog event only after the request lifecycle", async () => {
    const { writeProviderStructuredLine } = await loadProviderRuntime();

    writeProviderStructuredLine(routeLine(201));

    expect(providerMocks.captureImmediate).not.toHaveBeenCalled();
    expect(providerMocks.afterCallbacks).toHaveLength(1);
    await providerMocks.afterCallbacks[0]!();
    expect(providerMocks.captureImmediate).toHaveBeenCalledOnce();
    expect(providerMocks.captureImmediate).toHaveBeenCalledWith({
      distinctId: REQUEST_ID,
      event: "server_route_completed",
      disableGeoip: true,
      properties: {
        v: 1,
        route: "public.booking",
        method: "POST",
        requestId: REQUEST_ID,
        status: 201,
        outcome: "success",
        durationMs: 17,
        environment: "preview",
        release: RELEASE,
        $process_person_profile: false,
      },
    });
    expect(providerMocks.posthogConstructors).toEqual([
      {
        token: process.env.POSTHOG_PROJECT_TOKEN,
        options: {
          host: "https://eu.i.posthog.com",
          persistence: "memory",
          flushAt: 1,
          flushInterval: 0,
          requestTimeout: 500,
          fetchRetryCount: 0,
          fetchRetryDelay: 0,
          disableRemoteConfig: true,
          disableSurveys: true,
          preloadFeatureFlags: false,
          sendFeatureFlagEvent: false,
          enableExceptionAutocapture: false,
          disableGeoip: true,
        },
      },
    ]);
  });

  it("captures only the fixed surrogate and strips poison data before Sentry transport", async () => {
    const poison =
      "Mario mario@example.test +39 333 123 4567 Bearer abc cookie=secret " +
      "postgresql://user:password@example.test/gioia";
    const { captureProviderUnexpected } = await loadProviderRuntime();
    const { UnexpectedServerError } =
      await import("@/lib/server/observability/errorReporter.ts");
    const surrogate = new UnexpectedServerError();

    captureProviderUnexpected(surrogate, {
      route: "public.booking",
      method: "POST",
      requestId: REQUEST_ID,
    });

    expect(providerMocks.captureException).not.toHaveBeenCalled();
    expect(providerMocks.sentryScopes).toEqual([]);
    expect(providerMocks.afterCallbacks).toHaveLength(1);
    await providerMocks.afterCallbacks[0]!();
    expect(providerMocks.captureException).toHaveBeenCalledOnce();
    expect(providerMocks.captureException.mock.calls[0]?.[0]).toBe(surrogate);
    expect(providerMocks.sentryScopes).toEqual([
      {
        tags: { route: "public.booking", method: "POST" },
        extra: { requestId: REQUEST_ID },
      },
    ]);
    expect(providerMocks.flush).toHaveBeenCalledWith(500);

    const sentryOptions = providerMocks.initSentry.mock.calls[0]?.[0] as Record<
      string,
      unknown
    >;
    const sanitized = (sentryOptions.beforeSend as (event: unknown) => unknown)(
      {
        event_id: "event-id",
        timestamp: 1,
        tags: { route: "public.booking", method: "POST", poison },
        extra: { requestId: REQUEST_ID, poison },
        request: {
          url: `https://example.test/?note=${encodeURIComponent(poison)}`,
        },
        user: { email: "mario@example.test", ip_address: "192.0.2.1" },
        breadcrumbs: [{ message: poison }],
        contexts: { poison: { value: poison } },
        exception: { values: [{ value: poison, stacktrace: { frames: [] } }] },
      },
    );
    const serialized = JSON.stringify(sanitized);

    expect(serialized).not.toContain(poison);
    expect(serialized).not.toContain("mario@example.test");
    expect(serialized).not.toContain("192.0.2.1");
    expect(sanitized).toEqual({
      type: undefined,
      event_id: "event-id",
      timestamp: 1,
      platform: "node",
      level: "error",
      logger: "gioia.observability",
      environment: "preview",
      release: RELEASE,
      tags: { route: "public.booking", method: "POST" },
      extra: { requestId: REQUEST_ID },
      fingerprint: ["UNEXPECTED_SERVER_ERROR", "public.booking", "POST"],
      exception: {
        values: [
          {
            type: "UnexpectedServerError",
            value: "UNEXPECTED_SERVER_ERROR",
          },
        ],
      },
    });
  });

  it("uses no default Sentry integrations, tracing, logs, or request collection", async () => {
    const { writeProviderStructuredLine } = await loadProviderRuntime();
    writeProviderStructuredLine(routeLine());

    expect(providerMocks.initSentry).toHaveBeenCalledOnce();
    expect(providerMocks.initSentry.mock.calls[0]?.[0]).toMatchObject({
      environment: "preview",
      release: RELEASE,
      skipOpenTelemetrySetup: true,
      registerEsmLoaderHooks: false,
      enableLogs: false,
      sendClientReports: false,
      includeLocalVariables: false,
      dataCollection: {
        userInfo: false,
        cookies: false,
        httpHeaders: { request: false, response: false },
        httpBodies: [],
        urlQueryParams: false,
        graphQL: { document: false, variables: false },
        genAI: { inputs: false, outputs: false },
        databaseQueryData: false,
        stackFrameVariables: false,
        frameContextLines: 0,
      },
    });
    const options = providerMocks.initSentry.mock.calls[0]?.[0] as Record<
      string,
      unknown
    >;
    expect(options).not.toHaveProperty("tracesSampleRate");
    expect(options).not.toHaveProperty("tracesSampler");
  });

  it("fails open when disabled, malformed, scheduling throws, or providers reject", async () => {
    delete process.env.SENTRY_DSN;
    const disabled = await loadProviderRuntime();
    expect(() =>
      disabled.writeProviderStructuredLine(routeLine()),
    ).not.toThrow();
    expect(providerMocks.initSentry).not.toHaveBeenCalled();

    vi.resetModules();
    setValidEnvironment();
    providerMocks.after.mockImplementation(() => {
      throw new Error("scheduler unavailable");
    });
    const schedulingFailure = await loadProviderRuntime();
    expect(() =>
      schedulingFailure.writeProviderStructuredLine(routeLine()),
    ).not.toThrow();

    vi.resetModules();
    providerMocks.after.mockImplementation((callback: () => Promise<void>) => {
      providerMocks.afterCallbacks.push(callback);
    });
    providerMocks.captureImmediate.mockRejectedValue(
      new Error("provider unavailable"),
    );
    const rejection = await loadProviderRuntime();
    rejection.writeProviderStructuredLine(routeLine());
    await expect(
      providerMocks.afterCallbacks.at(-1)!(),
    ).resolves.toBeUndefined();
  });

  it("releases the deferred lifecycle when a provider never settles", async () => {
    vi.useFakeTimers();
    providerMocks.captureImmediate.mockReturnValue(new Promise(() => {}));
    const { writeProviderStructuredLine } = await loadProviderRuntime();

    writeProviderStructuredLine(routeLine());
    const deferred = providerMocks.afterCallbacks[0]!();
    let completed = false;
    void deferred.then(() => {
      completed = true;
    });

    await vi.advanceTimersByTimeAsync(749);
    expect(completed).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    await deferred;
    expect(completed).toBe(true);
    vi.useRealTimers();
  });

  it("rejects malformed or extra-key events without scheduling", async () => {
    const { writeProviderStructuredLine } = await loadProviderRuntime();
    const extra = JSON.parse(routeLine()) as Record<string, unknown>;
    extra.customerEmail = "mario@example.test";

    writeProviderStructuredLine(JSON.stringify(extra));
    writeProviderStructuredLine('{"event":"route_completed"}');
    writeProviderStructuredLine("not-json");

    expect(providerMocks.after).not.toHaveBeenCalled();
    expect(providerMocks.captureImmediate).not.toHaveBeenCalled();
  });
});

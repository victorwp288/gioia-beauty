import "server-only";

import * as Sentry from "@sentry/node";
import { after } from "next/server";
import { PostHog } from "posthog-node";

import {
  OBSERVED_METHODS,
  OBSERVED_OUTCOMES,
  OBSERVED_ROUTES,
  parseUnexpectedErrorContext,
  type UnexpectedErrorContext,
} from "./contracts.ts";
import type {
  ErrorCaptureSink,
  UnexpectedServerError,
} from "./errorReporter.ts";
import {
  readProviderConfiguration,
  type ProviderConfiguration,
} from "./providerConfiguration.ts";

const ROUTES = new Set<string>(OBSERVED_ROUTES);
const METHODS = new Set<string>(OBSERVED_METHODS);
const OUTCOMES = new Set<string>(OBSERVED_OUTCOMES);
const REQUEST_ID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const PROVIDER_DEADLINE_MS = 750;

interface ProviderRouteMetric {
  readonly route: (typeof OBSERVED_ROUTES)[number];
  readonly method: (typeof OBSERVED_METHODS)[number];
  readonly requestId: string;
  readonly status: number;
  readonly outcome: (typeof OBSERVED_OUTCOMES)[number];
  readonly durationMs: number;
}

interface ProviderRuntime {
  readonly configuration: ProviderConfiguration;
  readonly sentryClient: Sentry.NodeClient;
  readonly posthogClient: PostHog;
}

let providerRuntime: ProviderRuntime | null | undefined;

function scheduleDeferred(task: () => PromiseLike<unknown>): void {
  try {
    after(
      () =>
        new Promise<void>((resolve) => {
          let settled = false;
          const finish = (): void => {
            if (settled) return;
            settled = true;
            clearTimeout(deadline);
            resolve();
          };
          const deadline = setTimeout(finish, PROVIDER_DEADLINE_MS);

          try {
            Promise.resolve(task()).then(finish, finish);
          } catch {
            finish();
          }
        }),
    );
  } catch {
    // Observability is disabled when no Next.js request lifecycle is active.
  }
}

export function sanitizeSentryEvent(
  event: Sentry.ErrorEvent,
  configuration: ProviderConfiguration,
): Sentry.ErrorEvent | null {
  try {
    const route = event.tags?.route;
    const method = event.tags?.method;
    const requestId = event.extra?.requestId;
    if (
      typeof route !== "string" ||
      !ROUTES.has(route) ||
      typeof method !== "string" ||
      !METHODS.has(method) ||
      typeof requestId !== "string" ||
      !REQUEST_ID_PATTERN.test(requestId)
    ) {
      return null;
    }

    return {
      type: undefined,
      event_id: event.event_id,
      timestamp: event.timestamp,
      platform: "node",
      level: "error",
      logger: "gioia.observability",
      environment: configuration.environment,
      release: configuration.release,
      tags: { route, method },
      extra: { requestId },
      fingerprint: ["UNEXPECTED_SERVER_ERROR", route, method],
      exception: {
        values: [
          {
            type: "UnexpectedServerError",
            value: "UNEXPECTED_SERVER_ERROR",
          },
        ],
      },
    };
  } catch {
    return null;
  }
}

function createProviderRuntime(): ProviderRuntime | null {
  try {
    const configuration = readProviderConfiguration();
    if (!configuration) return null;

    const sentryClient = Sentry.initWithoutDefaultIntegrations({
      dsn: configuration.sentryDsn,
      environment: configuration.environment,
      release: configuration.release,
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
      beforeSend: (event) => sanitizeSentryEvent(event, configuration),
    });
    if (!sentryClient) return null;

    const posthogClient = new PostHog(configuration.posthogProjectToken, {
      host: configuration.posthogHost,
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
    });

    return Object.freeze({ configuration, sentryClient, posthogClient });
  } catch {
    return null;
  }
}

function getProviderRuntime(): ProviderRuntime | null {
  if (providerRuntime === undefined) {
    providerRuntime = createProviderRuntime();
  }
  return providerRuntime;
}

function parseRouteMetric(line: string): ProviderRouteMetric | null {
  try {
    const value: unknown = JSON.parse(line);
    if (
      typeof value !== "object" ||
      value === null ||
      Array.isArray(value) ||
      Object.getPrototypeOf(value) !== Object.prototype
    ) {
      return null;
    }
    const data = value as Record<string, unknown>;
    const expectedKeys = [
      "v",
      "ts",
      "event",
      "route",
      "method",
      "requestId",
      "status",
      "outcome",
      "durationMs",
    ];
    if (
      Reflect.ownKeys(data).length !== expectedKeys.length ||
      !expectedKeys.every((key) => Object.hasOwn(data, key)) ||
      data.v !== 1 ||
      data.event !== "route_completed" ||
      typeof data.route !== "string" ||
      !ROUTES.has(data.route) ||
      typeof data.method !== "string" ||
      !METHODS.has(data.method) ||
      typeof data.requestId !== "string" ||
      !REQUEST_ID_PATTERN.test(data.requestId) ||
      !Number.isInteger(data.status) ||
      Number(data.status) < 100 ||
      Number(data.status) > 599 ||
      typeof data.outcome !== "string" ||
      !OUTCOMES.has(data.outcome) ||
      !Number.isInteger(data.durationMs) ||
      Number(data.durationMs) < 0 ||
      Number(data.durationMs) > 300_000
    ) {
      return null;
    }

    return Object.freeze({
      route: data.route as ProviderRouteMetric["route"],
      method: data.method as ProviderRouteMetric["method"],
      requestId: data.requestId,
      status: Number(data.status),
      outcome: data.outcome as ProviderRouteMetric["outcome"],
      durationMs: Number(data.durationMs),
    });
  } catch {
    return null;
  }
}

export function writeProviderStructuredLine(line: string): void {
  try {
    const metric = parseRouteMetric(line);
    const runtime = getProviderRuntime();
    if (!metric || !runtime) return;

    scheduleDeferred(() =>
      runtime.posthogClient.captureImmediate({
        distinctId: metric.requestId,
        event: "server_route_completed",
        disableGeoip: true,
        properties: {
          v: 1,
          route: metric.route,
          method: metric.method,
          requestId: metric.requestId,
          status: metric.status,
          outcome: metric.outcome,
          durationMs: metric.durationMs,
          environment: runtime.configuration.environment,
          release: runtime.configuration.release,
          $process_person_profile: false,
        },
      }),
    );
  } catch {
    // Observability must never change business behavior.
  }
}

export const captureProviderUnexpected: ErrorCaptureSink = (
  error: UnexpectedServerError,
  input: Readonly<UnexpectedErrorContext>,
): void => {
  try {
    const context = parseUnexpectedErrorContext(input);
    const runtime = getProviderRuntime();
    if (!context || !runtime || error.message !== "UNEXPECTED_SERVER_ERROR") {
      return;
    }

    scheduleDeferred(async () => {
      const scope = new Sentry.Scope();
      scope.setTags({ route: context.route, method: context.method });
      scope.setExtra("requestId", context.requestId);
      runtime.sentryClient.captureException(error, {}, scope);
      await runtime.sentryClient.flush(500);
    });
  } catch {
    // Observability must never change business behavior.
  }
};

import "server-only";

export const MAX_OBSERVABILITY_DURATION_MS = 300_000;
export const MAX_OBSERVABILITY_LINE_BYTES = 1_024;

export const OBSERVED_ROUTES = [
  "admin.appointment.create",
  "admin.appointment.details",
  "admin.appointment.reschedule",
  "admin.appointment.status",
  "admin.block.create",
  "admin.block.details",
  "admin.block.reschedule",
  "admin.outbox.list",
  "admin.outbox.retry",
  "admin.schedule.cancel",
  "admin.schedule.count",
  "admin.schedule.export",
  "admin.schedule.list",
  "admin.subscriber.list",
  "admin.vacation.cancel",
  "admin.vacation.create",
  "admin.vacation.list",
  "auth.login",
  "auth.logout",
  "auth.session",
  "cron.outbox",
  "email.booking.legacy",
  "email.cancellation.legacy",
  "health",
  "public.availability",
  "public.booking",
  "public.newsletter.confirm",
  "public.newsletter.subscribe",
  "public.newsletter.unsubscribe",
  "webhook.resend",
] as const;

export const OBSERVED_METHODS = ["GET", "POST"] as const;
export const OBSERVED_OUTCOMES = [
  "success",
  "client_error",
  "conflict",
  "rate_limited",
  "server_error",
] as const;

export type ObservedRoute = (typeof OBSERVED_ROUTES)[number];
export type ObservedMethod = (typeof OBSERVED_METHODS)[number];
export type ObservedOutcome = (typeof OBSERVED_OUTCOMES)[number];

export interface RouteMetricInput {
  readonly route: ObservedRoute;
  readonly method: ObservedMethod;
  readonly requestId: string;
  readonly status: number;
  readonly durationMs: number;
}

export interface UnexpectedErrorContext {
  readonly route: ObservedRoute;
  readonly method: ObservedMethod;
  readonly requestId: string;
}

const ROUTES = new Set<string>(OBSERVED_ROUTES);
const METHODS = new Set<string>(OBSERVED_METHODS);
const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

function exactDataValues(
  value: unknown,
  keys: readonly string[],
): Record<string, unknown> | null {
  try {
    if (typeof value !== "object" || value === null || Array.isArray(value)) {
      return null;
    }
    const prototype = Object.getPrototypeOf(value);
    if (prototype !== Object.prototype && prototype !== null) return null;
    const actualKeys = Reflect.ownKeys(value);
    if (
      actualKeys.length !== keys.length ||
      !keys.every((key) => Object.hasOwn(value, key))
    ) {
      return null;
    }

    const copy: Record<string, unknown> = {};
    for (const key of keys) {
      const descriptor = Object.getOwnPropertyDescriptor(value, key);
      if (!descriptor || !("value" in descriptor) || !descriptor.enumerable) {
        return null;
      }
      copy[key] = descriptor.value;
    }
    return copy;
  } catch {
    return null;
  }
}

function isRoute(value: unknown): value is ObservedRoute {
  return typeof value === "string" && ROUTES.has(value);
}

function isMethod(value: unknown): value is ObservedMethod {
  return typeof value === "string" && METHODS.has(value);
}

function isRequestId(value: unknown): value is string {
  return typeof value === "string" && UUID_PATTERN.test(value);
}

function isStatus(value: unknown): value is number {
  return (
    Number.isInteger(value) && Number(value) >= 100 && Number(value) <= 599
  );
}

function isDuration(value: unknown): value is number {
  return (
    Number.isInteger(value) &&
    Number(value) >= 0 &&
    Number(value) <= MAX_OBSERVABILITY_DURATION_MS
  );
}

export function parseRouteMetricInput(value: unknown): RouteMetricInput | null {
  const data = exactDataValues(value, [
    "route",
    "method",
    "requestId",
    "status",
    "durationMs",
  ]);
  if (
    !data ||
    !isRoute(data.route) ||
    !isMethod(data.method) ||
    !isRequestId(data.requestId) ||
    !isStatus(data.status) ||
    !isDuration(data.durationMs)
  ) {
    return null;
  }
  return Object.freeze({
    route: data.route,
    method: data.method,
    requestId: data.requestId,
    status: data.status,
    durationMs: data.durationMs,
  });
}

export function parseUnexpectedErrorContext(
  value: unknown,
): UnexpectedErrorContext | null {
  const data = exactDataValues(value, ["route", "method", "requestId"]);
  if (
    !data ||
    !isRoute(data.route) ||
    !isMethod(data.method) ||
    !isRequestId(data.requestId)
  ) {
    return null;
  }
  return Object.freeze({
    route: data.route,
    method: data.method,
    requestId: data.requestId,
  });
}

export function classifyRouteOutcome(status: number): ObservedOutcome {
  if (status === 409) return "conflict";
  if (status === 429) return "rate_limited";
  if (status >= 500) return "server_error";
  if (status >= 400) return "client_error";
  return "success";
}

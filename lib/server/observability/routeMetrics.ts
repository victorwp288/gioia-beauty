import "server-only";

import { randomUUID } from "node:crypto";
import { performance } from "node:perf_hooks";
import { types } from "node:util";

import {
  MAX_OBSERVABILITY_DURATION_MS,
  parseUnexpectedErrorContext,
  type ObservedMethod,
  type ObservedRoute,
  type UnexpectedErrorContext,
} from "./contracts.ts";
import type { ErrorReporter } from "./errorReporter.ts";
import { safelyInvokeSink } from "./safeSink.ts";
import type { StructuredLogger } from "./structuredLogger.ts";

const RUNTIME_VALIDATION_REQUEST_ID = "00000000-0000-4000-8000-000000000000";
const RESPONSE_STATUS_GETTER = Object.getOwnPropertyDescriptor(
  Response.prototype,
  "status",
)?.get;

export interface RouteObserverOptions {
  readonly route: ObservedRoute;
  readonly method: ObservedMethod;
  readonly logger: Pick<StructuredLogger, "routeCompleted">;
  readonly errorReporter: ErrorReporter;
  readonly requestId?: () => string;
  readonly clock?: () => number;
}

export type RouteHandler<Arguments extends readonly unknown[]> = (
  ...arguments_: Arguments
) => Response | Promise<Response>;

interface RouteObserverRuntime {
  readonly route: ObservedRoute;
  readonly method: ObservedMethod;
  readonly routeCompleted: (input: unknown) => unknown;
  readonly captureUnexpected: (context: unknown) => unknown;
  readonly requestId: () => string;
  readonly clock: () => number;
}

function safelyCreateRuntime(
  options: RouteObserverOptions,
): RouteObserverRuntime | null {
  try {
    const route = options.route;
    const method = options.method;
    const logger = options.logger;
    const errorReporter = options.errorReporter;
    const routeCompleted = logger.routeCompleted;
    const captureUnexpected = errorReporter.captureUnexpected;
    const configuredRequestId = options.requestId;
    const configuredClock = options.clock;
    const requestId =
      configuredRequestId === undefined ? randomUUID : configuredRequestId;
    const clock =
      configuredClock === undefined ? () => performance.now() : configuredClock;
    const validLabels = parseUnexpectedErrorContext({
      route,
      method,
      requestId: RUNTIME_VALIDATION_REQUEST_ID,
    });

    if (
      !validLabels ||
      typeof routeCompleted !== "function" ||
      typeof captureUnexpected !== "function" ||
      typeof requestId !== "function" ||
      typeof clock !== "function"
    ) {
      return null;
    }

    return Object.freeze({
      route,
      method,
      routeCompleted: (input: unknown) =>
        Reflect.apply(routeCompleted, logger, [input]),
      captureUnexpected: (context: unknown) =>
        Reflect.apply(captureUnexpected, errorReporter, [context]),
      requestId,
      clock,
    });
  } catch {
    return null;
  }
}

function safelyReadClock(clock: () => number): number | null {
  try {
    const value = clock();
    return Number.isFinite(value) ? value : null;
  } catch {
    return null;
  }
}

function elapsedMilliseconds(
  startedAt: number | null,
  endedAt: number | null,
): number {
  if (startedAt === null || endedAt === null || endedAt < startedAt) return 0;
  return Math.min(
    MAX_OBSERVABILITY_DURATION_MS,
    Math.max(0, Math.round(endedAt - startedAt)),
  );
}

function safelyReadStatus(response: Response): number | null {
  try {
    if (
      types.isProxy(response) ||
      typeof RESPONSE_STATUS_GETTER !== "function"
    ) {
      return null;
    }
    const status = Reflect.apply(RESPONSE_STATUS_GETTER, response, []);
    return Number.isInteger(status) && status >= 100 && status <= 599
      ? status
      : null;
  } catch {
    return null;
  }
}

function safelyCreateContext(
  route: ObservedRoute,
  method: ObservedMethod,
  requestId: () => string,
): UnexpectedErrorContext | null {
  try {
    return parseUnexpectedErrorContext({
      route,
      method,
      requestId: requestId(),
    });
  } catch {
    return null;
  }
}

export function observeRoute<Arguments extends readonly unknown[]>(
  options: RouteObserverOptions,
  handler: RouteHandler<Arguments>,
): RouteHandler<Arguments> {
  const runtime = safelyCreateRuntime(options);
  if (!runtime) return handler;

  return (...arguments_: Arguments): Response | Promise<Response> => {
    const context = safelyCreateContext(
      runtime.route,
      runtime.method,
      runtime.requestId,
    );
    const startedAt = safelyReadClock(runtime.clock);

    const complete = (status: number): void => {
      if (!context) return;
      safelyInvokeSink(runtime.routeCompleted, [
        {
          ...context,
          status,
          durationMs: elapsedMilliseconds(
            startedAt,
            safelyReadClock(runtime.clock),
          ),
        },
      ]);
    };

    const returned = (response: Response): Response => {
      const status = safelyReadStatus(response);
      if (status !== null) {
        if (status >= 500 && context) {
          safelyInvokeSink(runtime.captureUnexpected, [context]);
        }
        complete(status);
      }
      return response;
    };

    const failed = (error: unknown): never => {
      if (context) {
        safelyInvokeSink(runtime.captureUnexpected, [context]);
        complete(500);
      }
      throw error;
    };

    try {
      const result = handler(...arguments_);
      return types.isPromise(result)
        ? result.then(returned, failed)
        : returned(result);
    } catch (error) {
      return failed(error);
    }
  };
}

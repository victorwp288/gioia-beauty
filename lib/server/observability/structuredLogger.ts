import "server-only";

import {
  MAX_OBSERVABILITY_LINE_BYTES,
  classifyRouteOutcome,
  parseRouteMetricInput,
  parseUnexpectedErrorContext,
} from "./contracts.ts";
import { safelyInvokeSink } from "./safeSink.ts";

export interface StructuredLogger {
  readonly routeCompleted: (input: unknown) => void;
  readonly unexpectedError: (context: unknown) => void;
}

export interface StructuredLoggerOptions {
  readonly sink: (line: string) => void;
  readonly now?: () => Date;
}

function timestamp(now: () => Date): string | null {
  try {
    const value = now();
    const milliseconds = Date.prototype.getTime.call(value);
    return Number.isFinite(milliseconds)
      ? new Date(milliseconds).toISOString()
      : null;
  } catch {
    return null;
  }
}

function emit(
  sink: (line: string) => void,
  event: Readonly<Record<string, unknown>>,
): void {
  try {
    const line = `${JSON.stringify(event)}\n`;
    if (Buffer.byteLength(line, "utf8") > MAX_OBSERVABILITY_LINE_BYTES) return;
    safelyInvokeSink(sink, [line]);
  } catch {
    // Observability must never change business behavior.
  }
}

export function createStructuredLogger({
  sink,
  now = () => new Date(),
}: StructuredLoggerOptions): StructuredLogger {
  function routeCompleted(input: unknown): void {
    try {
      const metric = parseRouteMetricInput(input);
      const observedAt = timestamp(now);
      if (!metric || !observedAt || typeof sink !== "function") return;
      emit(sink, {
        v: 1,
        ts: observedAt,
        event: "route_completed",
        route: metric.route,
        method: metric.method,
        requestId: metric.requestId,
        status: metric.status,
        outcome: classifyRouteOutcome(metric.status),
        durationMs: metric.durationMs,
      });
    } catch {
      // Observability must never change business behavior.
    }
  }

  function unexpectedError(input: unknown): void {
    try {
      const context = parseUnexpectedErrorContext(input);
      const observedAt = timestamp(now);
      if (!context || !observedAt || typeof sink !== "function") return;
      emit(sink, {
        v: 1,
        ts: observedAt,
        event: "unexpected_error",
        route: context.route,
        method: context.method,
        requestId: context.requestId,
      });
    } catch {
      // Observability must never change business behavior.
    }
  }

  return Object.freeze({ routeCompleted, unexpectedError });
}

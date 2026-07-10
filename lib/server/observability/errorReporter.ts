import "server-only";

import {
  parseUnexpectedErrorContext,
  type UnexpectedErrorContext,
} from "./contracts.ts";
import type { StructuredLogger } from "./structuredLogger.ts";
import { safelyInvokeSink } from "./safeSink.ts";

export class UnexpectedServerError extends Error {
  constructor() {
    super("UNEXPECTED_SERVER_ERROR");
    this.name = "UnexpectedServerError";
  }
}

export type ErrorCaptureSink = (
  error: UnexpectedServerError,
  context: Readonly<UnexpectedErrorContext>,
) => void;

export interface ErrorReporter {
  readonly captureUnexpected: (context: unknown) => void;
}

export interface ErrorReporterOptions {
  readonly sink: ErrorCaptureSink | null;
  readonly logger: Pick<StructuredLogger, "unexpectedError">;
}

export function createErrorReporter({
  sink,
  logger,
}: ErrorReporterOptions): ErrorReporter {
  function captureUnexpected(input: unknown): void {
    try {
      const context = parseUnexpectedErrorContext(input);
      if (!context) return;

      try {
        const unexpectedError = logger.unexpectedError;
        if (typeof unexpectedError === "function") {
          safelyInvokeSink(unexpectedError, [context]);
        }
      } catch {
        // Observability must never change business behavior.
      }

      if (typeof sink !== "function") return;
      const surrogate = new UnexpectedServerError();
      Error.captureStackTrace?.(surrogate, captureUnexpected);
      safelyInvokeSink(sink, [surrogate, context]);
    } catch {
      // Observability must never change business behavior.
    }
  }

  return Object.freeze({ captureUnexpected });
}

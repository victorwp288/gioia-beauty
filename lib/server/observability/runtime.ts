import "server-only";

import { type ObservedMethod, type ObservedRoute } from "./contracts.ts";
import { createErrorReporter } from "./errorReporter.ts";
import { observeRoute, type RouteHandler } from "./routeMetrics.ts";
import { createStructuredLogger } from "./structuredLogger.ts";

function writeStructuredLine(line: string): void {
  if (process.env.OBSERVABILITY_TRANSPORT !== "console") return;
  process.stdout.write(line);
}

const structuredLogger = createStructuredLogger({ sink: writeStructuredLine });
const errorReporter = createErrorReporter({
  sink: null,
  logger: structuredLogger,
});

export function observeServerRoute<Arguments extends readonly unknown[]>(
  route: ObservedRoute,
  method: ObservedMethod,
  handler: RouteHandler<Arguments>,
): RouteHandler<Arguments> {
  return observeRoute(
    {
      route,
      method,
      logger: structuredLogger,
      errorReporter,
    },
    handler,
  );
}

import "server-only";

import { randomUUID } from "node:crypto";

import { createLocalTestOutboxRuntime } from "@/lib/server/email/localTestOutboxRuntime.ts";
import { createOutboxWorkerInvocationGetHandler } from "@/lib/server/email/outboxWorkerInvocation.ts";
import { observeServerRoute } from "@/lib/server/observability/runtime";
import { apiErrorResponse } from "@/lib/server/publicApiResponse.ts";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 30;

async function get(request: Request): Promise<Response> {
  try {
    const runtimeConfiguration = createLocalTestOutboxRuntime();
    return createOutboxWorkerInvocationGetHandler({
      worker: runtimeConfiguration.worker,
      cronSecret: runtimeConfiguration.cronSecret,
      requestId: randomUUID,
    })(request);
  } catch {
    return apiErrorResponse(503, "SERVICE_UNAVAILABLE");
  }
}

export const GET = observeServerRoute("cron.outbox", "GET", get);

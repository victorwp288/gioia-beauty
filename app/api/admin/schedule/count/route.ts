import "server-only";

import { ownerScheduleReadRepository } from "@/lib/server/database/ownerScheduleReadRepository.ts";
import { createNextOwnerReadContext } from "@/lib/server/nextOwnerReadContext.ts";
import { observeServerRoute } from "@/lib/server/observability/runtime";
import { createOwnerScheduleCountGetHandler } from "@/lib/server/ownerScheduleReadHandler.ts";
import { apiErrorResponse } from "@/lib/server/publicApiResponse.ts";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

async function scheduleCountGetHandler(request: Request): Promise<Response> {
  try {
    return await createOwnerScheduleCountGetHandler({
      loadRuntimeContext: () => createNextOwnerReadContext(request),
      execute: ownerScheduleReadRepository.countSchedule,
    })(request);
  } catch {
    return apiErrorResponse(503, "SERVICE_UNAVAILABLE");
  }
}

export const GET = observeServerRoute(
  "admin.schedule.count",
  "GET",
  scheduleCountGetHandler,
);

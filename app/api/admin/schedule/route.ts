import "server-only";

import { ownerScheduleReadRepository } from "@/lib/server/database/ownerScheduleReadRepository.ts";
import { createNextOwnerReadContext } from "@/lib/server/nextOwnerReadContext.ts";
import { observeServerRoute } from "@/lib/server/observability/runtime";
import { createOwnerScheduleListGetHandler } from "@/lib/server/ownerScheduleReadHandler.ts";
import { createRuntimePaginationCursorCodec } from "@/lib/server/paginationCursorRuntime.ts";
import { apiErrorResponse } from "@/lib/server/publicApiResponse.ts";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

async function scheduleListGetHandler(request: Request): Promise<Response> {
  try {
    return await createOwnerScheduleListGetHandler({
      cursorCodec: createRuntimePaginationCursorCodec(),
      loadRuntimeContext: () => createNextOwnerReadContext(request),
      execute: ownerScheduleReadRepository.listSchedule,
    })(request);
  } catch {
    return apiErrorResponse(503, "SERVICE_UNAVAILABLE");
  }
}

export const GET = observeServerRoute(
  "admin.schedule.list",
  "GET",
  scheduleListGetHandler,
);

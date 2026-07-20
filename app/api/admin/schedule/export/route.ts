import "server-only";

import { ownerScheduleReadRepository } from "@/lib/server/database/ownerScheduleReadRepository.ts";
import { createNextOwnerReadContext } from "@/lib/server/nextOwnerReadContext.ts";
import { observeServerRoute } from "@/lib/server/observability/runtime";
import { createOwnerScheduleExportGetHandler } from "@/lib/server/ownerScheduleExportHandler.ts";
import { createRuntimePaginationCursorCodec } from "@/lib/server/paginationCursorRuntime.ts";
import { apiErrorResponse } from "@/lib/server/publicApiResponse.ts";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

async function scheduleExportGetHandler(request: Request): Promise<Response> {
  try {
    return await createOwnerScheduleExportGetHandler({
      cursorCodec: createRuntimePaginationCursorCodec(),
      loadRuntimeContext: () => createNextOwnerReadContext(request),
      execute: ownerScheduleReadRepository.exportSchedule,
    })(request);
  } catch {
    return apiErrorResponse(503, "SERVICE_UNAVAILABLE");
  }
}

export const GET = observeServerRoute(
  "admin.schedule.export",
  "GET",
  scheduleExportGetHandler,
);

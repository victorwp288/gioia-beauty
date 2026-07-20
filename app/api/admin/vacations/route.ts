import "server-only";

import { ownerOperationsReadRepository } from "@/lib/server/database/ownerOperationsReadRepository.ts";
import { createNextOwnerReadContext } from "@/lib/server/nextOwnerReadContext.ts";
import { observeServerRoute } from "@/lib/server/observability/runtime";
import { createNextOwnerScheduleCommandRoute } from "@/lib/server/nextOwnerScheduleCommandRoute.ts";
import { createRuntimePaginationCursorCodec } from "@/lib/server/paginationCursorRuntime.ts";
import { apiErrorResponse } from "@/lib/server/publicApiResponse.ts";
import { createOwnerVacationListGetHandler } from "@/lib/server/ownerVacationSubscriberReadHandler.ts";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
async function vacationListGetHandler(request: Request): Promise<Response> {
  try {
    return await createOwnerVacationListGetHandler({
      cursorCodec: createRuntimePaginationCursorCodec(),
      loadRuntimeContext: () => createNextOwnerReadContext(request),
      execute: ownerOperationsReadRepository.listVacations,
    })(request);
  } catch {
    return apiErrorResponse(503, "SERVICE_UNAVAILABLE");
  }
}
const postHandler = createNextOwnerScheduleCommandRoute("createVacation");
export const GET = observeServerRoute(
  "admin.vacation.list",
  "GET",
  vacationListGetHandler,
);
export const POST = observeServerRoute(
  "admin.vacation.create",
  "POST",
  postHandler,
);

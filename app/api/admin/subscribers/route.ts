import "server-only";

import { ownerOperationsReadRepository } from "@/lib/server/database/ownerOperationsReadRepository.ts";
import { createNextOwnerReadContext } from "@/lib/server/nextOwnerReadContext.ts";
import { observeServerRoute } from "@/lib/server/observability/runtime";
import { createOwnerSubscriberListGetHandler } from "@/lib/server/ownerVacationSubscriberReadHandler.ts";
import { createRuntimePaginationCursorCodec } from "@/lib/server/paginationCursorRuntime.ts";
import { apiErrorResponse } from "@/lib/server/publicApiResponse.ts";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

async function subscriberListGetHandler(request: Request): Promise<Response> {
  try {
    return await createOwnerSubscriberListGetHandler({
      cursorCodec: createRuntimePaginationCursorCodec(),
      loadRuntimeContext: () => createNextOwnerReadContext(request),
      execute: ownerOperationsReadRepository.listSubscribers,
    })(request);
  } catch {
    return apiErrorResponse(503, "SERVICE_UNAVAILABLE");
  }
}

export const GET = observeServerRoute(
  "admin.subscriber.list",
  "GET",
  subscriberListGetHandler,
);

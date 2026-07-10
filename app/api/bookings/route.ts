import "server-only";

import { publicAbuseGuard } from "@/lib/server/publicAbuseBoundary.ts";
import { publicBookingRepository } from "@/lib/server/database/publicBookingRepository.ts";
import { createPublicBookingPostHandler } from "@/lib/server/publicBookingHandler.ts";
import { observeServerRoute } from "@/lib/server/observability/runtime";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
const postHandler = createPublicBookingPostHandler({
  abuseGuard: publicAbuseGuard,
  database: publicBookingRepository,
});
export const POST = observeServerRoute("public.booking", "POST", postHandler);

import "server-only";

import { createAvailabilityGetHandler } from "@/lib/server/availabilityHandler.ts";
import { publicAbuseGuard } from "@/lib/server/publicAbuseBoundary.ts";
import { publicBookingRepository } from "@/lib/server/database/publicBookingRepository.ts";
import { observeServerRoute } from "@/lib/server/observability/runtime";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
const getHandler = createAvailabilityGetHandler({
  abuseGuard: publicAbuseGuard,
  database: publicBookingRepository,
});
export const GET = observeServerRoute("public.availability", "GET", getHandler);

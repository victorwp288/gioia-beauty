import "server-only";

import { createAvailabilityGetHandler } from "@/lib/server/availabilityHandler.ts";
import { publicAbuseGuard } from "@/lib/server/publicAbuseBoundary.ts";
import { publicBookingRepository } from "@/lib/server/database/publicBookingRepository.ts";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const GET = createAvailabilityGetHandler({
  abuseGuard: publicAbuseGuard,
  database: publicBookingRepository,
});

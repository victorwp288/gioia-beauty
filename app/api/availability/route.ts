import "server-only";

import { createAvailabilityGetHandler } from "@/lib/server/availabilityHandler.ts";
import { publicBookingRepository } from "@/lib/server/database/publicBookingRepository.ts";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const GET = createAvailabilityGetHandler({
  database: publicBookingRepository,
});

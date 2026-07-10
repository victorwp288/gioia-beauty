import "server-only";

import { publicAbuseGuard } from "@/lib/server/publicAbuseBoundary.ts";
import { publicBookingRepository } from "@/lib/server/database/publicBookingRepository.ts";
import { createPublicBookingPostHandler } from "@/lib/server/publicBookingHandler.ts";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const POST = createPublicBookingPostHandler({
  abuseGuard: publicAbuseGuard,
  database: publicBookingRepository,
});

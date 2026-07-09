import "server-only";

import { publicBookingRepository } from "@/lib/server/database/publicBookingRepository.ts";
import { createPublicBookingPostHandler } from "@/lib/server/publicBookingHandler.ts";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const POST = createPublicBookingPostHandler({
  database: publicBookingRepository,
});

import "server-only";

import { observeServerRoute } from "@/lib/server/observability/runtime";
import { createNextOwnerScheduleCommandRoute } from "@/lib/server/nextOwnerScheduleCommandRoute.ts";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
const postHandler = createNextOwnerScheduleCommandRoute("cancelScheduleEntry");
export const POST = observeServerRoute(
  "admin.schedule.cancel",
  "POST",
  postHandler,
);

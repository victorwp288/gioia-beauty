import "server-only";

import { createNextOwnerScheduleCommandRoute } from "@/lib/server/nextOwnerScheduleCommandRoute.ts";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const POST = createNextOwnerScheduleCommandRoute("cancelScheduleEntry");

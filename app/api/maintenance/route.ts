import "server-only";

import { createMaintenanceStatusGetHandler } from "@/lib/server/maintenanceStatusHandler.ts";
import { observeServerRoute } from "@/lib/server/observability/runtime";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const getHandler = createMaintenanceStatusGetHandler();
export const GET = observeServerRoute(
  "public.maintenance.status",
  "GET",
  getHandler,
);

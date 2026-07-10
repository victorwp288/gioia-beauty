import "server-only";

import { createHealthGetHandler } from "@/lib/server/healthHandler.ts";
import { observeServerRoute } from "@/lib/server/observability/runtime";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
const getHandler = createHealthGetHandler();
export const GET = observeServerRoute("health", "GET", getHandler);

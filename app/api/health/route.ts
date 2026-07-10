import "server-only";

import { createHealthGetHandler } from "@/lib/server/healthHandler.ts";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const GET = createHealthGetHandler();

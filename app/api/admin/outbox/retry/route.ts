import { createNextOwnerOutboxRetryRoute } from "@/lib/server/nextOwnerOutboxRetryRoute.ts";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export const POST = createNextOwnerOutboxRetryRoute();

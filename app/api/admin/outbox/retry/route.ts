import { createNextOwnerOutboxRetryRoute } from "@/lib/server/nextOwnerOutboxRetryRoute.ts";
import { observeServerRoute } from "@/lib/server/observability/runtime";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const postHandler = createNextOwnerOutboxRetryRoute();
export const POST = observeServerRoute(
  "admin.outbox.retry",
  "POST",
  postHandler,
);

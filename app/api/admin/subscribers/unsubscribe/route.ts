import { createNextOwnerSubscriberUnsubscribeRoute } from "@/lib/server/nextOwnerSubscriberCommandRoute.ts";
import { observeServerRoute } from "@/lib/server/observability/runtime";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const postHandler = createNextOwnerSubscriberUnsubscribeRoute();
export const POST = observeServerRoute(
  "admin.subscribers.unsubscribe",
  "POST",
  postHandler,
);

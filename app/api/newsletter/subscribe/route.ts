import "server-only";

import { publicAbuseGuard } from "@/lib/server/publicAbuseBoundary.ts";
import { publicSubscriberRepository } from "@/lib/server/database/publicSubscriberRepository.ts";
import { observeServerRoute } from "@/lib/server/observability/runtime";
import { createPublicNewsletterSubscribePostHandler } from "@/lib/server/publicNewsletterSubscribeHandler.ts";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const handler = createPublicNewsletterSubscribePostHandler({
  repository: publicSubscriberRepository,
  abuseGuard: publicAbuseGuard,
});

export const POST = observeServerRoute(
  "public.newsletter.subscribe",
  "POST",
  handler,
);

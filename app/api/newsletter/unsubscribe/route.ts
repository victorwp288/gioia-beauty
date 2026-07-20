import "server-only";

import { cookies } from "next/headers";

import { publicAbuseGuard } from "@/lib/server/publicAbuseBoundary.ts";
import { publicSubscriberRepository } from "@/lib/server/database/publicSubscriberRepository.ts";
import { NEWSLETTER_ACTION_CSRF_COOKIE } from "@/lib/server/newsletterActionCsrf.ts";
import { createNewsletterActionTokenCodec } from "@/lib/server/newsletterActionToken.ts";
import { parseNewsletterActionTokenEnvironment } from "@/lib/server/newsletterActionTokenEnvironment.ts";
import { observeServerRoute } from "@/lib/server/observability/runtime";
import { apiErrorResponse } from "@/lib/server/publicApiResponse.ts";
import { createPublicNewsletterActionPostHandler } from "@/lib/server/publicNewsletterActionHandler.ts";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

async function post(request: Request): Promise<Response> {
  try {
    const store = await cookies();
    const csrfToken = store.get(NEWSLETTER_ACTION_CSRF_COOKIE)?.value;
    return createPublicNewsletterActionPostHandler({
      action: "unsubscribe",
      repository: publicSubscriberRepository,
      tokenCodec: createNewsletterActionTokenCodec(
        parseNewsletterActionTokenEnvironment(),
      ),
      abuseGuard: publicAbuseGuard,
      readCsrfCookie: () => csrfToken,
      secureCookie: new URL(request.url).protocol === "https:",
    })(request);
  } catch {
    return apiErrorResponse(503, "SERVICE_UNAVAILABLE");
  }
}

export const POST = observeServerRoute(
  "public.newsletter.unsubscribe",
  "POST",
  post,
);

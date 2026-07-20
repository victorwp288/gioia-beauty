import "server-only";

import { createNewsletterActionLandingGetHandler } from "@/lib/server/newsletterActionLanding.ts";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export function GET(request: Request): Response {
  try {
    return createNewsletterActionLandingGetHandler({
      action: "confirm",
      secureCookie: new URL(request.url).protocol === "https:",
    })(request);
  } catch {
    return new Response(null, { status: 400 });
  }
}

import "server-only";

import { createResendWebhookPostHandler } from "@/lib/server/email/resendWebhookHandler.ts";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 15;
export const POST = createResendWebhookPostHandler();

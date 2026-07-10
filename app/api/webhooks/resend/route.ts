import "server-only";

import { createResendWebhookPostHandler } from "@/lib/server/email/resendWebhookHandler.ts";
import { observeServerRoute } from "@/lib/server/observability/runtime";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 15;
const postHandler = createResendWebhookPostHandler();
export const POST = observeServerRoute("webhook.resend", "POST", postHandler);

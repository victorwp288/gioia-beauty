import { CancelEmailTemplate } from "@/components/email/CancelEmailTemplate";
import { cancellationEmailRequestSchema } from "@/lib/server/emailRequestSchemas";
import { requireFirebaseOwner } from "@/lib/server/firebaseOwnerAuth";
import {
  getClientAddress,
  isSameOriginRequest,
  jsonResponse,
  readValidatedJson,
} from "@/lib/server/http";
import { createFixedWindowRateLimiter } from "@/lib/server/rateLimit";
import { deliverEmail, safeDeliveryErrorCode } from "@/lib/server/resend";

const cancellationEmailLimiter = createFixedWindowRateLimiter({
  limit: 20,
  windowMs: 15 * 60 * 1000,
});

export function createCancellationEmailPostHandler({
  authorize = requireFirebaseOwner,
  deliver = deliverEmail,
  limiter = cancellationEmailLimiter,
} = {}) {
  return async function cancellationEmailPost(request) {
    if (!isSameOriginRequest(request)) {
      return jsonResponse({ error: "forbidden_origin" }, 403);
    }

    const rateLimit = limiter.check(getClientAddress(request));
    if (!rateLimit.allowed) {
      const retryAfter = Math.max(
        1,
        Math.ceil((rateLimit.resetAt - Date.now()) / 1000),
      );
      return jsonResponse({ error: "rate_limited" }, 429, {
        "Retry-After": String(retryAfter),
      });
    }

    const authorization = await authorize(request);
    if (!authorization.ok) {
      return jsonResponse({ error: authorization.code }, authorization.status);
    }

    const parsed = await readValidatedJson(
      request,
      cancellationEmailRequestSchema,
    );
    if (!parsed.ok) return parsed.response;

    const { email, ...templateData } = parsed.data;

    try {
      await deliver({
        from: "Gioia Beauty <noreply@gioiabeauty.net>",
        to: [email],
        subject: "Cancellazione appuntamento",
        react: CancelEmailTemplate(templateData),
      });

      return jsonResponse({
        success: true,
        delivery: { customer: { status: "sent" } },
      });
    } catch (error) {
      const code = safeDeliveryErrorCode(error);
      console.error("Cancellation email delivery failed", {
        recipientKind: "customer",
        code,
      });
      return jsonResponse(
        {
          success: false,
          delivery: { customer: { status: "failed", code } },
        },
        502,
      );
    }
  };
}

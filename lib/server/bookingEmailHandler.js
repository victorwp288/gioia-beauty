import { EmailTemplate } from "@/components/email/EmailTemplate";
import { bookingEmailRequestSchema } from "@/lib/server/emailRequestSchemas";
import { requireFirebaseOwner } from "@/lib/server/firebaseOwnerAuth";
import {
  getClientAddress,
  isSameOriginRequest,
  jsonResponse,
  readValidatedJson,
} from "@/lib/server/http";
import { createFixedWindowRateLimiter } from "@/lib/server/rateLimit";
import { deliverEmail, safeDeliveryErrorCode } from "@/lib/server/resend";

const DEFAULT_ADMIN_EMAIL = "owner@example.test";
const bookingEmailLimiter = createFixedWindowRateLimiter({
  limit: 5,
  windowMs: 15 * 60 * 1000,
});

async function attemptDelivery(deliver, recipientKind, message) {
  try {
    await deliver(message);
    return { status: "sent" };
  } catch (error) {
    const code = safeDeliveryErrorCode(error);
    console.error("Booking email delivery failed", { recipientKind, code });
    return { status: "failed", code };
  }
}

function responseStatus(delivery) {
  const results = Object.values(delivery);
  const failed = results.filter((result) => result.status === "failed").length;
  const sent = results.filter((result) => result.status === "sent").length;

  if (failed === 0) return 200;
  return sent > 0 ? 207 : 502;
}

export function createBookingEmailPostHandler({
  authorize = requireFirebaseOwner,
  deliver = deliverEmail,
  limiter = bookingEmailLimiter,
  adminEmail = process.env.BOOKING_ADMIN_EMAIL || DEFAULT_ADMIN_EMAIL,
} = {}) {
  return async function bookingEmailPost(request) {
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

    const parsed = await readValidatedJson(request, bookingEmailRequestSchema);
    if (!parsed.ok) return parsed.response;

    const { email, ...templateData } = parsed.data;
    const customerDelivery = email
      ? attemptDelivery(deliver, "customer", {
          from: "Gioia Beauty <noreply@gioiabeauty.net>",
          to: [email],
          subject: "Ricevuta di prenotazione",
          react: EmailTemplate(templateData),
        })
      : Promise.resolve({ status: "skipped", reason: "no_recipient" });

    const adminDelivery = attemptDelivery(deliver, "admin", {
      from: "Gioia Beauty <noreply@gioiabeauty.net>",
      to: [adminEmail],
      subject: "Nuova prenotazione",
      react: EmailTemplate({ ...templateData, isAdmin: true }),
    });

    const [customer, admin] = await Promise.all([
      customerDelivery,
      adminDelivery,
    ]);
    const delivery = { customer, admin };
    const status = responseStatus(delivery);

    return jsonResponse({ success: status === 200, delivery }, status);
  };
}

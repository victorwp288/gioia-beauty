import { randomUUID } from "node:crypto";

import { Resend } from "resend";

let resendClient;

export function safeDeliveryErrorCode(error) {
  const code = typeof error?.code === "string" ? error.code : "";
  return /^[a-z0-9][a-z0-9_-]{0,63}$/i.test(code)
    ? code.toLowerCase()
    : "delivery_failed";
}

function getResendClient() {
  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) {
    const error = new Error("Email provider is not configured");
    error.code = "email_not_configured";
    throw error;
  }

  resendClient ||= new Resend(apiKey);
  return resendClient;
}

export async function deliverEmail(message) {
  const transport = process.env.EMAIL_TRANSPORT;
  if (transport === "fake") {
    return { messageId: `fake_${randomUUID()}`, transport: "fake" };
  }
  if (transport !== "resend") {
    const error = new Error("Email transport is disabled");
    error.code = "email_transport_disabled";
    throw error;
  }

  const { data, error } = await getResendClient().emails.send(message);

  if (error) {
    const providerError = new Error("Email provider rejected the request");
    providerError.code = error.name || "provider_rejected";
    throw providerError;
  }

  return { messageId: data?.id || null };
}

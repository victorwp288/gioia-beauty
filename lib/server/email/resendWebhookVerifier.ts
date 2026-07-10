import "server-only";

import { Webhook } from "svix";

export interface ResendWebhookHeaders {
  readonly "svix-id": string;
  readonly "svix-timestamp": string;
  readonly "svix-signature": string;
}

export interface ResendWebhookVerifier {
  verify(payload: Buffer, headers: ResendWebhookHeaders): unknown;
}

export class ResendWebhookConfigurationError extends Error {
  constructor() {
    super("Resend webhook verifier is not configured");
    this.name = "ResendWebhookConfigurationError";
  }
}

export function createResendWebhookVerifier(
  webhookSecret: string | undefined,
): ResendWebhookVerifier {
  if (
    !webhookSecret ||
    webhookSecret.trim() !== webhookSecret ||
    !/^whsec_[A-Za-z0-9+/_=-]{32,256}$/.test(webhookSecret)
  ) {
    throw new ResendWebhookConfigurationError();
  }

  try {
    const webhook = new Webhook(webhookSecret);
    return {
      verify(payload, headers) {
        return webhook.verify(payload, headers);
      },
    };
  } catch {
    throw new ResendWebhookConfigurationError();
  }
}

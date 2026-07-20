import "server-only";

import {
  NewsletterActionTokenConfigurationError,
  decodeNewsletterActionTokenKeyring,
  type NewsletterActionTokenCodecConfiguration,
} from "./newsletterActionTokenKeyring.ts";

const ENVIRONMENT_KEY = "NEWSLETTER_ACTION_TOKEN_KEYS";
const MAX_CONFIGURATION_BYTES = 2_048;

export function parseNewsletterActionTokenEnvironment(
  env: Readonly<Record<string, string | undefined>> = process.env,
): Readonly<NewsletterActionTokenCodecConfiguration> {
  try {
    const encoded = env[ENVIRONMENT_KEY];
    if (
      typeof encoded !== "string" ||
      encoded.trim() !== encoded ||
      Buffer.byteLength(encoded, "utf8") > MAX_CONFIGURATION_BYTES
    ) {
      throw new NewsletterActionTokenConfigurationError();
    }
    const candidate = JSON.parse(encoded) as unknown;
    const decoded = decodeNewsletterActionTokenKeyring(candidate);
    const keys = decoded.map((key) =>
      Object.freeze({ id: key.id, secret: key.secret.toString("base64url") }),
    );
    Object.freeze(keys);
    return Object.freeze({ keys });
  } catch {
    throw new NewsletterActionTokenConfigurationError();
  }
}

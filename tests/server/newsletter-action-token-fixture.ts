import { createHmac } from "node:crypto";

import {
  createNewsletterActionTokenCodec,
  type NewsletterActionClaimsInput,
  type NewsletterActionTokenKeyConfiguration,
} from "@/lib/server/newsletterActionToken.ts";

export { createNewsletterActionTokenCodec };
export type { NewsletterActionTokenKeyConfiguration };

export const SECRET = Buffer.alloc(32, 0x5a).toString("base64url");
export const OTHER_SECRET = Buffer.alloc(32, 0x6b).toString("base64url");
export const PRIMARY_KEY = Object.freeze({ id: "primary_1", secret: SECRET });
export const PREVIOUS_KEY = Object.freeze({
  id: "previous_1",
  secret: OTHER_SECRET,
});
export const NOW = new Date("2026-07-09T12:00:00.000Z");
export const CLAIMS = {
  version: 1 as const,
  purpose: "newsletter_confirm" as const,
  tokenId: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
  subscriberId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
  subscriberVersion: 7,
  issuedAt: "2026-07-09T10:00:00.000Z",
  expiresAt: "2026-07-10T10:00:00.000Z",
};
export const INVALID = Object.freeze({
  ok: false,
  code: "INVALID_NEWSLETTER_ACTION_TOKEN",
});

export function codec(
  keys: readonly NewsletterActionTokenKeyConfiguration[] = [PRIMARY_KEY],
) {
  return createNewsletterActionTokenCodec({ keys });
}

export function issue(
  claims: NewsletterActionClaimsInput = CLAIMS,
  now = NOW,
  signingKeyId = PRIMARY_KEY.id,
) {
  return codec().issue({ claims, signingKeyId, now });
}

export function verify(
  token: string | null | undefined,
  expectedPurpose:
    "newsletter_confirm" | "newsletter_unsubscribe" = "newsletter_confirm",
  now = NOW,
) {
  return codec().verify({ token, expectedPurpose, now });
}

export function signedPayloadSegment(
  payload: string,
  key = PRIMARY_KEY,
  header = `n1-${key.id}`,
) {
  const tag = createHmac("sha256", Buffer.from(key.secret, "base64url"))
    .update(`gioia:newsletter-action:v1\0${header}.${payload}`, "utf8")
    .digest("base64url");
  return `${header}.${payload}.${tag}`;
}

export function signedBytes(bytes: Uint8Array, key = PRIMARY_KEY) {
  return signedPayloadSegment(Buffer.from(bytes).toString("base64url"), key);
}

export function signedRaw(raw: string, key = PRIMARY_KEY) {
  return signedBytes(Buffer.from(raw, "utf8"), key);
}

export function rawClaims(claims: Record<string, unknown>) {
  return JSON.stringify({
    version: claims.version,
    purpose: claims.purpose,
    tokenId: claims.tokenId,
    subscriberId: claims.subscriberId,
    subscriberVersion: claims.subscriberVersion,
    issuedAt: claims.issuedAt,
    expiresAt: claims.expiresAt,
  });
}

export function changedCharacter(value: string, index: number) {
  const replacement = value[index] === "A" ? "B" : "A";
  return `${value.slice(0, index)}${replacement}${value.slice(index + 1)}`;
}

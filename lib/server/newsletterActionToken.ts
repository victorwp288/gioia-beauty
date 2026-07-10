import "server-only";

import { createHmac, timingSafeEqual } from "node:crypto";
import { TextDecoder } from "node:util";

import type { z } from "zod";

import {
  NewsletterActionClaimsSchema,
  NewsletterActionPurposeSchema,
  isNewsletterActionTokenKeyId,
  parseTimeBoundNewsletterActionClaims,
  safeParseNewsletterActionTokenWire,
  type NewsletterActionClaims,
} from "@/lib/domain/schemas/subscriber-tokens.ts";
import {
  decodeNewsletterActionTokenKeyring,
  newsletterActionTokenKeyWithId,
  type NewsletterActionTokenCodecConfiguration,
} from "@/lib/server/newsletterActionTokenKeyring.ts";

export {
  NewsletterActionTokenConfigurationError,
  type NewsletterActionTokenCodecConfiguration,
  type NewsletterActionTokenKeyConfiguration,
} from "@/lib/server/newsletterActionTokenKeyring.ts";

const FORMAT_PREFIX = "n1-";
const MAC_CONTEXT = "gioia:newsletter-action:v1\0";
const SIGNATURE_BYTES = 32;
const BASE64URL_256_PATTERN = /^[A-Za-z0-9_-]{43}$/;
const FATAL_UTF8_DECODER = new TextDecoder("utf-8", { fatal: true });
declare const authenticatedNewsletterActionClaimsBrand: unique symbol;

export type NewsletterActionPurpose = z.infer<
  typeof NewsletterActionPurposeSchema
>;

export type NewsletterActionClaimsInput = z.input<
  typeof NewsletterActionClaimsSchema
>;

export interface IssueNewsletterActionTokenInput {
  claims: NewsletterActionClaimsInput;
  signingKeyId: string;
  now: Date;
}

export interface VerifyNewsletterActionTokenInput {
  token: string | null | undefined;
  expectedPurpose: NewsletterActionPurpose;
  now: Date;
}

export type NewsletterActionTokenVerification =
  | Readonly<{
      ok: true;
      claims: AuthenticatedNewsletterActionClaims;
    }>
  | Readonly<{
      ok: false;
      code: "INVALID_NEWSLETTER_ACTION_TOKEN";
    }>;

export interface NewsletterActionTokenCodec {
  issue(input: IssueNewsletterActionTokenInput): string;
  verify(
    input: VerifyNewsletterActionTokenInput,
  ): NewsletterActionTokenVerification;
}

export type AuthenticatedNewsletterActionClaims =
  Readonly<NewsletterActionClaims> & {
    readonly [authenticatedNewsletterActionClaimsBrand]: true;
  };

export class NewsletterActionTokenInputError extends Error {
  constructor() {
    super("Newsletter action token input is invalid");
    this.name = "NewsletterActionTokenInputError";
  }
}

const INVALID_TOKEN = Object.freeze({
  ok: false as const,
  code: "INVALID_NEWSLETTER_ACTION_TOKEN" as const,
});

function tokenHeader(keyId: string): string {
  return `${FORMAT_PREFIX}${keyId}`;
}

function canonicalClaims(claims: NewsletterActionClaims) {
  return {
    version: claims.version,
    purpose: claims.purpose,
    tokenId: claims.tokenId,
    subscriberId: claims.subscriberId,
    subscriberVersion: claims.subscriberVersion,
    issuedAt: claims.issuedAt,
    expiresAt: claims.expiresAt,
  } as const;
}

function encodedClaims(claims: NewsletterActionClaims): string {
  return Buffer.from(JSON.stringify(canonicalClaims(claims)), "utf8").toString(
    "base64url",
  );
}

function tokenSignature(
  header: string,
  encodedPayload: string,
  secret: Buffer,
): Buffer {
  return createHmac("sha256", secret)
    .update(`${MAC_CONTEXT}${header}.${encodedPayload}`, "utf8")
    .digest();
}

function decodedSignature(value: string): Buffer | null {
  if (!BASE64URL_256_PATTERN.test(value)) return null;
  const decoded = Buffer.from(value, "base64url");
  if (
    decoded.length !== SIGNATURE_BYTES ||
    decoded.toString("base64url") !== value
  ) {
    return null;
  }
  return decoded;
}

function parsedIssueClaims(
  payload: unknown,
  now: Date,
): NewsletterActionClaims {
  const parsed = NewsletterActionClaimsSchema.safeParse(payload);
  if (!parsed.success) throw new NewsletterActionTokenInputError();
  try {
    return parseTimeBoundNewsletterActionClaims(
      parsed.data,
      parsed.data.purpose,
      now,
    );
  } catch {
    throw new NewsletterActionTokenInputError();
  }
}

function parsedVerifiedClaims(
  encodedPayload: string,
  expectedPurpose: NewsletterActionPurpose,
  now: Date,
): NewsletterActionClaims | null {
  let rawPayload: string;
  let payload: unknown;
  try {
    const decoded = Buffer.from(encodedPayload, "base64url");
    if (decoded.toString("base64url") !== encodedPayload) return null;
    rawPayload = FATAL_UTF8_DECODER.decode(decoded);
    payload = JSON.parse(rawPayload);
  } catch {
    return null;
  }

  let claims: NewsletterActionClaims;
  try {
    claims = parseTimeBoundNewsletterActionClaims(
      payload,
      expectedPurpose,
      now,
    );
  } catch {
    return null;
  }

  if (
    rawPayload !== JSON.stringify(canonicalClaims(claims)) ||
    encodedPayload !== encodedClaims(claims)
  ) {
    return null;
  }
  return claims;
}

/**
 * Authenticates immutable, time- and purpose-bound claims. This primitive does
 * not authorize a subscriber transition, conceal claims, revoke or consume a
 * token, or make a token single-use. The caller supplies the snapshotted
 * signing-key ID; an operational adapter must retain that key through expiry.
 */
export function createNewsletterActionTokenCodec(
  configuration: NewsletterActionTokenCodecConfiguration,
): Readonly<NewsletterActionTokenCodec> {
  const keyring = decodeNewsletterActionTokenKeyring(configuration);

  return Object.freeze({
    issue(input: IssueNewsletterActionTokenInput): string {
      if (
        !input ||
        !(input.now instanceof Date) ||
        typeof input.signingKeyId !== "string" ||
        !isNewsletterActionTokenKeyId(input.signingKeyId)
      ) {
        throw new NewsletterActionTokenInputError();
      }
      const signingKey = newsletterActionTokenKeyWithId(
        keyring,
        input.signingKeyId,
      );
      if (!signingKey) throw new NewsletterActionTokenInputError();
      const claims = parsedIssueClaims(input.claims, input.now);
      const payload = encodedClaims(claims);
      const header = tokenHeader(signingKey.id);
      const signature = tokenSignature(
        header,
        payload,
        signingKey.secret,
      ).toString("base64url");
      const token = `${header}.${payload}.${signature}`;
      const wire = safeParseNewsletterActionTokenWire(token);
      if (!wire) throw new NewsletterActionTokenInputError();
      return wire.token;
    },

    verify(input: VerifyNewsletterActionTokenInput) {
      if (
        !input ||
        !(input.now instanceof Date) ||
        !NewsletterActionPurposeSchema.safeParse(input.expectedPurpose).success
      ) {
        return INVALID_TOKEN;
      }

      const wire = safeParseNewsletterActionTokenWire(input.token);
      if (!wire) return INVALID_TOKEN;

      const actualSignature = decodedSignature(wire.encodedSignature);
      if (!actualSignature) return INVALID_TOKEN;
      const verificationKey = newsletterActionTokenKeyWithId(
        keyring,
        wire.keyId,
      );
      if (!verificationKey) return INVALID_TOKEN;
      const expectedSignature = tokenSignature(
        wire.header,
        wire.encodedPayload,
        verificationKey.secret,
      );
      if (
        actualSignature.length !== expectedSignature.length ||
        !timingSafeEqual(actualSignature, expectedSignature)
      ) {
        return INVALID_TOKEN;
      }

      const claims = parsedVerifiedClaims(
        wire.encodedPayload,
        input.expectedPurpose,
        input.now,
      );
      if (!claims) return INVALID_TOKEN;

      const frozenClaims = Object.freeze({
        ...canonicalClaims(claims),
      }) as AuthenticatedNewsletterActionClaims;
      return Object.freeze({ ok: true as const, claims: frozenClaims });
    },
  });
}

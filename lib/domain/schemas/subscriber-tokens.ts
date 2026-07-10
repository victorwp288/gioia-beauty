import { z } from "zod";

import {
  IsoInstantSchema,
  PositiveVersionSchema,
  UuidSchema,
} from "./primitives.ts";

const CONFIRMATION_LIFETIME_MILLISECONDS = 24 * 60 * 60 * 1_000;
const MAXIMUM_UNSUBSCRIBE_LIFETIME_MILLISECONDS = 30 * 24 * 60 * 60 * 1_000;
const MAXIMUM_TOKEN_WIRE_LENGTH = 512;
const BASE64URL_PATTERN = /^[A-Za-z0-9_-]+$/;
const BASE64URL_REMAINDER_TWO_FINAL_PATTERN = /^[AQgw]$/;
const BASE64URL_REMAINDER_THREE_FINAL_PATTERN = /^[AEIMQUYcgkosw048]$/;
const NEWSLETTER_ACTION_TOKEN_KEY_ID_PATTERN = /^[A-Za-z0-9_]{1,16}$/;

export function isNewsletterActionTokenKeyId(value: unknown): value is string {
  return (
    typeof value === "string" &&
    NEWSLETTER_ACTION_TOKEN_KEY_ID_PATTERN.test(value)
  );
}

export const NewsletterActionPurposeSchema = z.enum([
  "newsletter_confirm",
  "newsletter_unsubscribe",
]);

export const NewsletterActionClaimsSchema = z
  .object({
    version: z.literal(1),
    purpose: NewsletterActionPurposeSchema,
    subscriberId: UuidSchema,
    subscriberVersion: PositiveVersionSchema,
    tokenId: UuidSchema,
    issuedAt: IsoInstantSchema,
    expiresAt: IsoInstantSchema,
  })
  .strict()
  .superRefine((claims, context) => {
    const issuedAt = Date.parse(claims.issuedAt);
    const expiresAt = Date.parse(claims.expiresAt);
    const lifetime = expiresAt - issuedAt;
    const validLifetime =
      claims.purpose === "newsletter_confirm"
        ? lifetime === CONFIRMATION_LIFETIME_MILLISECONDS
        : lifetime > 0 && lifetime <= MAXIMUM_UNSUBSCRIBE_LIFETIME_MILLISECONDS;
    if (!validLifetime) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Newsletter action lifetime is invalid",
        path: ["expiresAt"],
      });
    }
  });

function isCanonicalBase64url(value: string): boolean {
  if (!BASE64URL_PATTERN.test(value)) return false;
  const remainder = value.length % 4;
  if (remainder === 0) return true;
  if (remainder === 1) return false;
  const finalCharacter = value.at(-1) ?? "";
  return remainder === 2
    ? BASE64URL_REMAINDER_TWO_FINAL_PATTERN.test(finalCharacter)
    : BASE64URL_REMAINDER_THREE_FINAL_PATTERN.test(finalCharacter);
}

interface UnbrandedNewsletterActionTokenWireParts {
  readonly token: string;
  readonly header: string;
  readonly keyId: string;
  readonly encodedPayload: string;
  readonly encodedSignature: string;
}

function parseUnbrandedNewsletterActionTokenWire(
  value: unknown,
): UnbrandedNewsletterActionTokenWireParts | null {
  if (typeof value !== "string" || value.length > MAXIMUM_TOKEN_WIRE_LENGTH) {
    return null;
  }
  const segments = value.split(".");
  if (segments.length !== 3) return null;
  const [header, encodedPayload, encodedSignature] = segments;
  if (!header || !encodedPayload || !encodedSignature) return null;
  const keyId = header.startsWith("n1-") ? header.slice(3) : "";
  if (
    !isNewsletterActionTokenKeyId(keyId) ||
    !isCanonicalBase64url(encodedPayload) ||
    encodedSignature.length !== 43 ||
    !isCanonicalBase64url(encodedSignature)
  ) {
    return null;
  }
  return {
    token: value,
    header,
    keyId,
    encodedPayload,
    encodedSignature,
  };
}

/** Structural framing only; this schema does not authenticate the token. */
export const NewsletterActionTokenWireSchema = z
  .string()
  .max(MAXIMUM_TOKEN_WIRE_LENGTH)
  .refine((value) => parseUnbrandedNewsletterActionTokenWire(value) !== null)
  .brand<"NewsletterActionTokenWire">();

export type NewsletterActionTokenWire = z.infer<
  typeof NewsletterActionTokenWireSchema
>;

export interface UnauthenticatedNewsletterActionTokenWire {
  readonly token: NewsletterActionTokenWire;
  readonly header: string;
  readonly keyId: string;
  readonly encodedPayload: string;
  readonly encodedSignature: string;
}

export function safeParseNewsletterActionTokenWire(
  value: unknown,
): Readonly<UnauthenticatedNewsletterActionTokenWire> | null {
  const token = NewsletterActionTokenWireSchema.safeParse(value);
  if (!token.success) return null;
  const parts = parseUnbrandedNewsletterActionTokenWire(token.data);
  if (!parts) return null;
  return Object.freeze({ ...parts, token: token.data });
}

export function parseTimeBoundNewsletterActionClaims(
  payload: unknown,
  expectedPurpose: z.infer<typeof NewsletterActionPurposeSchema>,
  now: Date = new Date(),
) {
  const claims = NewsletterActionClaimsSchema.parse(payload);
  const issuedAt = Date.parse(claims.issuedAt);
  const expiresAt = Date.parse(claims.expiresAt);
  const currentTime = now.getTime();
  if (
    !Number.isFinite(currentTime) ||
    claims.purpose !== expectedPurpose ||
    issuedAt > currentTime + 5 * 60 * 1_000 ||
    expiresAt <= currentTime
  ) {
    throw new z.ZodError([
      {
        code: z.ZodIssueCode.custom,
        message: "Newsletter action claims are not valid for this request",
        path: ["purpose"],
      },
    ]);
  }
  return claims;
}

export type NewsletterActionClaims = z.infer<
  typeof NewsletterActionClaimsSchema
>;

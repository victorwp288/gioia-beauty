import { z } from "zod";

import {
  IsoInstantSchema,
  PositiveVersionSchema,
  UuidSchema,
} from "./primitives.ts";

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
    const maximumLifetime = 30 * 24 * 60 * 60 * 1_000;
    if (expiresAt <= issuedAt || expiresAt - issuedAt > maximumLifetime) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Newsletter action lifetime is invalid",
        path: ["expiresAt"],
      });
    }
  });

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

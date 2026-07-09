import { z } from "zod";

import { IsoInstantSchema, UuidSchema } from "./primitives.ts";

export const NewsletterActionPurposeSchema = z.enum([
  "newsletter_confirm",
  "newsletter_unsubscribe",
]);

export const VerifiedNewsletterActionClaimsSchema = z
  .object({
    version: z.literal(1),
    purpose: NewsletterActionPurposeSchema,
    subscriberId: UuidSchema,
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

export function parseVerifiedNewsletterActionClaims(
  payload: unknown,
  expectedPurpose: z.infer<typeof NewsletterActionPurposeSchema>,
  now: Date = new Date(),
) {
  const claims = VerifiedNewsletterActionClaimsSchema.parse(payload);
  const issuedAt = Date.parse(claims.issuedAt);
  const expiresAt = Date.parse(claims.expiresAt);
  if (
    claims.purpose !== expectedPurpose ||
    issuedAt > now.getTime() + 5 * 60 * 1_000 ||
    expiresAt <= now.getTime()
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

export type VerifiedNewsletterActionClaims = z.infer<
  typeof VerifiedNewsletterActionClaimsSchema
>;

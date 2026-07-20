import { z } from "zod";

import {
  SchemaVersionSchema,
  persistenceIdentityFields,
  validateImportProvenance,
  validateTimestampOrder,
} from "./persistence.ts";
import {
  IdempotencyKeySchema,
  IsoInstantSchema,
  NormalizedEmailSchema,
  PositiveVersionSchema,
  UuidSchema,
} from "./primitives.ts";
import { NewsletterActionTokenWireSchema } from "./subscriber-tokens.ts";

export const SubscriberStatusSchema = z.enum([
  "legacy_unverified",
  "pending",
  "active",
  "unsubscribed",
  "bounced",
  "complained",
]);
export const SubscriberSourceSchema = z.enum(["public", "admin", "migration"]);
export const ConsentSourceSchema = z.string().trim().min(1).max(100);
export const ConsentPolicyVersionSchema = z.string().trim().min(1).max(100);

const subscriberDomainFields = {
  email: NormalizedEmailSchema,
  status: SubscriberStatusSchema,
  source: SubscriberSourceSchema,
  consentAt: IsoInstantSchema.nullable(),
  consentSource: ConsentSourceSchema.nullable(),
  consentPolicyVersion: ConsentPolicyVersionSchema.nullable(),
  confirmedAt: IsoInstantSchema.nullable(),
  unsubscribedAt: IsoInstantSchema.nullable(),
  version: PositiveVersionSchema,
};

const SubscriberPersistenceObjectSchema = z
  .object({
    ...persistenceIdentityFields,
    ...subscriberDomainFields,
  })
  .strict();

const AdminSubscriberDtoObjectSchema = z
  .object({
    id: UuidSchema,
    schemaVersion: SchemaVersionSchema,
    ...subscriberDomainFields,
    createdAt: IsoInstantSchema,
    updatedAt: IsoInstantSchema,
  })
  .strict();

type SubscriberCandidate =
  | z.infer<typeof SubscriberPersistenceObjectSchema>
  | z.infer<typeof AdminSubscriberDtoObjectSchema>;

function validateConsent(
  candidate: SubscriberCandidate,
  context: z.RefinementCtx,
) {
  const consentValues = [
    candidate.consentAt,
    candidate.consentSource,
    candidate.consentPolicyVersion,
  ];
  const consentCount = consentValues.filter((value) => value !== null).length;
  const consentRequired = [
    "pending",
    "active",
    "bounced",
    "complained",
  ].includes(candidate.status);

  if (
    (consentRequired && consentCount !== 3) ||
    (consentCount > 0 && consentCount < 3)
  ) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      message: "Consent provenance must be complete for this subscriber state",
      path: ["consentAt"],
    });
  }
  if (candidate.status === "active" && candidate.confirmedAt === null) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      message: "Active subscribers require confirmation",
      path: ["confirmedAt"],
    });
  }
  if (
    (candidate.status === "unsubscribed") !==
    (candidate.unsubscribedAt !== null)
  ) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      message: "Unsubscribe timestamp must match subscriber status",
      path: ["unsubscribedAt"],
    });
  }
}

function validateSubscriber(
  candidate: SubscriberCandidate,
  context: z.RefinementCtx,
) {
  validateConsent(candidate, context);
  validateTimestampOrder(candidate, context);

  if (
    candidate.status === "legacy_unverified" &&
    (candidate.source !== "migration" ||
      candidate.consentAt !== null ||
      candidate.confirmedAt !== null ||
      candidate.unsubscribedAt !== null)
  ) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      message: "Legacy-unverified subscribers must retain the migration shape",
      path: ["status"],
    });
  }
  if (
    candidate.confirmedAt !== null &&
    candidate.consentAt !== null &&
    candidate.confirmedAt < candidate.consentAt
  ) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      message: "Confirmation cannot precede consent",
      path: ["confirmedAt"],
    });
  }
  const unsubscribeLowerBound = candidate.confirmedAt ?? candidate.consentAt;
  if (
    candidate.unsubscribedAt !== null &&
    unsubscribeLowerBound !== null &&
    candidate.unsubscribedAt < unsubscribeLowerBound
  ) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      message: "Unsubscribe cannot precede consent or confirmation",
      path: ["unsubscribedAt"],
    });
  }
}

export const SubscriberPersistenceSchema =
  SubscriberPersistenceObjectSchema.superRefine((subscriber, context) => {
    validateSubscriber(subscriber, context);
    validateImportProvenance(subscriber, context);
  });

export const AdminSubscriberDtoSchema =
  AdminSubscriberDtoObjectSchema.superRefine(validateSubscriber);

export const PublicSubscribeCommandSchema = z
  .object({
    idempotencyKey: IdempotencyKeySchema,
    email: NormalizedEmailSchema,
    consent: z.literal(true),
  })
  .strict();

export const NewsletterUnsubscribeTokenWireSchema =
  NewsletterActionTokenWireSchema;
/** @deprecated Structural wire only; use NewsletterUnsubscribeTokenWireSchema. */
export const SignedUnsubscribeTokenSchema =
  NewsletterUnsubscribeTokenWireSchema;
export const PublicUnsubscribeCommandSchema = z
  .object({ token: NewsletterUnsubscribeTokenWireSchema })
  .strict();
export const PublicNewsletterConfirmCommandSchema = z
  .object({ token: NewsletterActionTokenWireSchema })
  .strict();

export const AdminSetSubscriberStatusCommandSchema = z
  .object({
    idempotencyKey: IdempotencyKeySchema,
    subscriberId: UuidSchema,
    expectedVersion: PositiveVersionSchema,
    status: z.enum(["active", "unsubscribed"]),
  })
  .strict();

export type SubscriberPersistence = z.infer<typeof SubscriberPersistenceSchema>;
export type AdminSubscriberDto = z.infer<typeof AdminSubscriberDtoSchema>;
export type PublicSubscribeCommand = z.infer<
  typeof PublicSubscribeCommandSchema
>;
export type PublicUnsubscribeCommand = z.infer<
  typeof PublicUnsubscribeCommandSchema
>;
export type PublicNewsletterConfirmCommand = z.infer<
  typeof PublicNewsletterConfirmCommandSchema
>;
export type AdminSetSubscriberStatusCommand = z.infer<
  typeof AdminSetSubscriberStatusCommandSchema
>;

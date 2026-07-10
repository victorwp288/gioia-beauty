import "server-only";

import { z } from "zod";

import {
  IsoInstantSchema,
  NormalizedEmailSchema,
  PositiveVersionSchema,
  UuidSchema,
  isNewsletterActionTokenKeyId,
} from "@/lib/domain/schemas/index.ts";
import type { NewsletterActionTokenCodec } from "@/lib/server/newsletterActionToken.ts";

import { EmailMessageSchema, type EmailMessage } from "./emailProvider.ts";
import { OutboxRendererOperationalError } from "./outboxRendererFault.ts";

const FROM = "Gioia Beauty <noreply@gioiabeauty.net>" as const;
const PRODUCTION_ORIGIN = "https://www.gioiabeauty.net";
const CONFIRMATION_PATH = "/newsletter/confirm";
const POLICY_URL = `${PRODUCTION_ORIGIN}/policy`;
const CONFIRMATION_LIFETIME_MS = 24 * 60 * 60 * 1_000;

export const NEWSLETTER_CONFIRMATION_TEMPLATE_VERSION = 1 as const;
export const NEWSLETTER_CONSENT_POLICY_VERSION =
  "newsletter-consent-v1" as const;

const NewsletterConfirmationActionSnapshotSchema = z
  .object({
    version: z.literal(1),
    purpose: z.literal("newsletter_confirm"),
    tokenId: UuidSchema,
    issuedAt: IsoInstantSchema,
    expiresAt: IsoInstantSchema,
    signingKeyId: z.string().refine(isNewsletterActionTokenKeyId),
  })
  .strict()
  .superRefine((action, context) => {
    if (
      Date.parse(action.expiresAt) - Date.parse(action.issuedAt) !==
      CONFIRMATION_LIFETIME_MS
    ) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Newsletter confirmation lifetime must be exactly 24 hours",
        path: ["expiresAt"],
      });
    }
  });

export const NewsletterConfirmationRenderSnapshotV1Schema = z
  .object({
    outboxId: UuidSchema,
    aggregateKind: z.literal("subscriber"),
    aggregateId: UuidSchema,
    aggregateVersion: PositiveVersionSchema,
    recipientKind: z.literal("subscriber"),
    recipientAddress: NormalizedEmailSchema,
    templateKind: z.literal("newsletter_confirmation"),
    templateData: z
      .object({
        policyVersion: z.literal(NEWSLETTER_CONSENT_POLICY_VERSION),
        action: NewsletterConfirmationActionSnapshotSchema,
      })
      .strict(),
    providerIdempotencyKey: z
      .string()
      .min(8)
      .max(255)
      .regex(/^[A-Za-z0-9._:-]{8,255}$/),
    attemptCount: z.number().int().min(1).max(20),
    expectedVersion: PositiveVersionSchema,
    leaseExpiresAt: IsoInstantSchema,
  })
  .strict();

export type NewsletterConfirmationRenderSnapshotV1 = z.infer<
  typeof NewsletterConfirmationRenderSnapshotV1Schema
>;

export class NewsletterConfirmationRendererConfigurationError extends Error {
  constructor() {
    super("Newsletter confirmation renderer is not configured");
    this.name = "NewsletterConfirmationRendererConfigurationError";
  }
}

export class NewsletterConfirmationRendererInputError extends Error {
  constructor() {
    super("Newsletter confirmation render input is invalid");
    this.name = "NewsletterConfirmationRendererInputError";
  }
}

export class NewsletterConfirmationRendererOperationalError extends OutboxRendererOperationalError {
  constructor() {
    super();
    this.name = "NewsletterConfirmationRendererOperationalError";
  }
}

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function confirmationUrl(token: string): string {
  const url = new URL(CONFIRMATION_PATH, PRODUCTION_ORIGIN);
  url.hash = `token=${encodeURIComponent(token)}`;
  return url.toString();
}

function renderHtml(url: string): string {
  return [
    '<!doctype html><html lang="it"><body style="font-family:Arial,sans-serif;color:#211d1a">',
    '<h1 style="font-size:24px">Conferma la tua iscrizione</h1>',
    '<p style="margin:0 0 16px">Abbiamo ricevuto una richiesta di iscrizione alla newsletter di Gioia Beauty.</p>',
    `<p style="margin:0 0 16px"><a href="${escapeHtml(url)}" style="display:inline-block;padding:12px 18px;background:#211d1a;color:#fff;text-decoration:none">Conferma l’iscrizione</a></p>`,
    '<p style="margin:0 0 16px">Conferma entro 24 ore dalla richiesta.</p>',
    '<p style="margin:0 0 16px">Se non hai effettuato la richiesta, ignora questa email: l’iscrizione non verrà completata.</p>',
    `<p style="margin:0 0 16px">Puoi consultare l’<a href="${POLICY_URL}">informativa sulla privacy</a>.</p>`,
    '<p style="margin:0 0 16px">Non è possibile rispondere a questa email.</p>',
    "</body></html>",
  ].join("");
}

function renderText(url: string): string {
  return [
    "Conferma la tua iscrizione",
    "",
    "Abbiamo ricevuto una richiesta di iscrizione alla newsletter di Gioia Beauty.",
    "",
    "Conferma l’iscrizione:",
    url,
    "",
    "Conferma entro 24 ore dalla richiesta.",
    "",
    "Se non hai effettuato la richiesta, ignora questa email: l’iscrizione non verrà completata.",
    "",
    `Informativa sulla privacy: ${POLICY_URL}`,
    "",
    "Non è possibile rispondere a questa email.",
  ].join("\n");
}

function claimsMatch(
  actual: {
    version: number;
    purpose: string;
    tokenId: string;
    subscriberId: string;
    subscriberVersion: number;
    issuedAt: string;
    expiresAt: string;
  },
  expected: typeof actual,
): boolean {
  return (
    actual.version === expected.version &&
    actual.purpose === expected.purpose &&
    actual.tokenId === expected.tokenId &&
    actual.subscriberId === expected.subscriberId &&
    actual.subscriberVersion === expected.subscriberVersion &&
    actual.issuedAt === expected.issuedAt &&
    actual.expiresAt === expected.expiresAt
  );
}

export function createNewsletterConfirmationEmailRendererV1({
  tokenCodec,
  now,
}: {
  readonly tokenCodec: NewsletterActionTokenCodec;
  readonly now: () => Date;
}) {
  let issue: NewsletterActionTokenCodec["issue"];
  let verify: NewsletterActionTokenCodec["verify"];
  let currentTime: () => Date;
  try {
    if (
      typeof tokenCodec?.issue !== "function" ||
      typeof tokenCodec?.verify !== "function" ||
      typeof now !== "function"
    ) {
      throw new NewsletterConfirmationRendererConfigurationError();
    }
    issue = tokenCodec.issue.bind(tokenCodec);
    verify = tokenCodec.verify.bind(tokenCodec);
    currentTime = now;
  } catch {
    throw new NewsletterConfirmationRendererConfigurationError();
  }

  return Object.freeze(function renderNewsletterConfirmationEmailV1(
    input: unknown,
  ): EmailMessage {
    let snapshot: NewsletterConfirmationRenderSnapshotV1;
    try {
      snapshot = NewsletterConfirmationRenderSnapshotV1Schema.parse(input);
    } catch {
      throw new NewsletterConfirmationRendererInputError();
    }

    try {
      const action = snapshot.templateData.action;
      const claims = {
        version: action.version,
        purpose: action.purpose,
        tokenId: action.tokenId,
        subscriberId: snapshot.aggregateId,
        subscriberVersion: snapshot.aggregateVersion,
        issuedAt: action.issuedAt,
        expiresAt: action.expiresAt,
      } as const;
      const renderTime = currentTime();
      if (
        !(renderTime instanceof Date) ||
        !Number.isFinite(renderTime.getTime())
      ) {
        throw new NewsletterConfirmationRendererOperationalError();
      }
      const currentMilliseconds = renderTime.getTime();
      if (
        Date.parse(action.issuedAt) > currentMilliseconds + 5 * 60 * 1_000 ||
        Date.parse(action.expiresAt) <= currentMilliseconds
      ) {
        throw new NewsletterConfirmationRendererInputError();
      }
      const token = issue({
        claims,
        signingKeyId: action.signingKeyId,
        now: renderTime,
      });
      const authenticated = verify({
        token,
        expectedPurpose: "newsletter_confirm",
        now: renderTime,
      });
      if (!authenticated.ok || !claimsMatch(authenticated.claims, claims)) {
        throw new NewsletterConfirmationRendererOperationalError();
      }
      const url = confirmationUrl(token);

      return EmailMessageSchema.parse({
        from: FROM,
        to: [snapshot.recipientAddress],
        subject: "Conferma l’iscrizione alla newsletter – Gioia Beauty",
        html: renderHtml(url),
        text: renderText(url),
      });
    } catch (error) {
      if (error instanceof NewsletterConfirmationRendererInputError) {
        throw error;
      }
      throw new NewsletterConfirmationRendererOperationalError();
    }
  });
}

import "server-only";

import { randomUUID } from "node:crypto";

import { z } from "zod";

import {
  PublicNonEnumeratingAcceptedResponseSchema,
  safeParseNewsletterActionTokenWire,
} from "@/lib/domain/schemas/index.ts";
import { requestFingerprint } from "./bookingSecurity.ts";
import type {
  AuthenticatedNewsletterActionClaims,
  NewsletterActionTokenCodec,
} from "./newsletterActionToken.ts";
import {
  clearNewsletterActionCsrfCookie,
  NEWSLETTER_ACTION_CSRF_COOKIE,
} from "./newsletterActionCsrf.ts";
import {
  evaluatePublicAbuseGuard,
  publicAbuseRejectionResponse,
  type PublicAbuseAction,
  type PublicAbuseGuard,
} from "./publicAbuseBoundary.ts";
import {
  apiErrorResponse,
  databaseErrorResponse,
  validatedJsonResponse,
} from "./publicApiResponse.ts";
import {
  readPublicNewsletterBody,
  validatePublicNewsletterRequest,
} from "./publicNewsletterRequest.ts";

const BodySchema = z.object({ token: z.string().min(1).max(512) }).strict();

type Action = "confirm" | "unsubscribe";
type RepositoryInput = Readonly<{
  principalScopeHash: Buffer;
  idempotencyKey: string;
  requestFingerprint: Buffer;
  claims: AuthenticatedNewsletterActionClaims;
  signingKeyId: string;
}>;

interface ActionRepository {
  confirm(input: RepositoryInput): Promise<unknown>;
  unsubscribe(input: RepositoryInput): Promise<unknown>;
}

const CONTRACT = {
  confirm: {
    path: "/api/newsletter/confirm",
    purpose: "newsletter_confirm",
    abuseAction: "public_newsletter_confirm",
  },
  unsubscribe: {
    path: "/api/newsletter/unsubscribe",
    purpose: "newsletter_unsubscribe",
    abuseAction: "public_newsletter_unsubscribe",
  },
} as const satisfies Record<
  Action,
  { path: string; purpose: string; abuseAction: PublicAbuseAction }
>;

function accepted(secureCookie: boolean): Response {
  return validatedJsonResponse(
    PublicNonEnumeratingAcceptedResponseSchema,
    { code: "REQUEST_ACCEPTED" },
    202,
    { "Set-Cookie": clearNewsletterActionCsrfCookie(secureCookie) },
  );
}

export function createPublicNewsletterActionPostHandler({
  action,
  repository,
  tokenCodec,
  abuseGuard,
  readCsrfCookie,
  now = () => new Date(),
  createRequestId = randomUUID,
  secureCookie = true,
}: {
  readonly action: Action;
  readonly repository: ActionRepository;
  readonly tokenCodec: NewsletterActionTokenCodec;
  readonly abuseGuard: PublicAbuseGuard;
  readonly readCsrfCookie: (
    request: Request,
    name: typeof NEWSLETTER_ACTION_CSRF_COOKIE,
  ) => string | null | undefined;
  readonly now?: () => Date;
  readonly createRequestId?: () => string;
  readonly secureCookie?: boolean;
}) {
  const contract = CONTRACT[action];
  if (!contract) throw new TypeError("Invalid newsletter action");

  return async function POST(request: Request): Promise<Response> {
    const requestId = createRequestId();
    let csrfCookie: string | null | undefined;
    try {
      csrfCookie = readCsrfCookie(request, NEWSLETTER_ACTION_CSRF_COOKIE);
    } catch {
      return apiErrorResponse(503, "SERVICE_UNAVAILABLE", requestId);
    }
    const framing = validatePublicNewsletterRequest(request, {
      path: contract.path,
      csrfCookieToken: csrfCookie,
    });
    if (!framing.ok) {
      return apiErrorResponse(framing.status, framing.code, requestId);
    }

    const abuse = await evaluatePublicAbuseGuard(
      abuseGuard,
      request,
      contract.abuseAction,
    );
    if (!abuse.ok) return publicAbuseRejectionResponse(abuse, requestId);

    const body = await readPublicNewsletterBody(request, BodySchema);
    if (!body.ok) return apiErrorResponse(body.status, body.code, requestId);

    let verified: ReturnType<NewsletterActionTokenCodec["verify"]>;
    try {
      const currentTime = now();
      if (
        !(currentTime instanceof Date) ||
        !Number.isFinite(currentTime.getTime())
      ) {
        return apiErrorResponse(503, "SERVICE_UNAVAILABLE", requestId);
      }
      verified = tokenCodec.verify({
        token: body.body.token,
        expectedPurpose: contract.purpose,
        now: currentTime,
      });
    } catch {
      return apiErrorResponse(503, "SERVICE_UNAVAILABLE", requestId);
    }
    if (!verified.ok) return accepted(secureCookie);
    const authenticatedWire = safeParseNewsletterActionTokenWire(
      body.body.token,
    );
    if (!authenticatedWire) {
      return apiErrorResponse(503, "SERVICE_UNAVAILABLE", requestId);
    }

    const tokenAbuse = await evaluatePublicAbuseGuard(
      abuseGuard,
      request,
      contract.abuseAction,
      {
        kind: "token",
        value: verified.claims.tokenId,
        humanVerified: abuse.humanVerified,
      },
    );
    if (!tokenAbuse.ok) return accepted(secureCookie);

    const fingerprint = requestFingerprint({
      operation: `public_newsletter_${action}`,
      version: 1,
      request: {
        tokenId: verified.claims.tokenId,
        subscriberId: verified.claims.subscriberId,
        subscriberVersion: verified.claims.subscriberVersion,
      },
    });
    try {
      const result = await repository[action]({
        principalScopeHash: Buffer.from(abuse.principalScopeHash),
        idempotencyKey: framing.idempotencyKey,
        requestFingerprint: fingerprint,
        claims: verified.claims,
        signingKeyId: authenticatedWire.keyId,
      });
      if (
        !result ||
        typeof result !== "object" ||
        (result as { httpStatus?: unknown }).httpStatus !== 202 ||
        (result as { code?: unknown }).code !== "REQUEST_ACCEPTED"
      ) {
        return apiErrorResponse(503, "SERVICE_UNAVAILABLE", requestId);
      }
      return accepted(secureCookie);
    } catch (error) {
      return databaseErrorResponse(error, requestId);
    }
  };
}

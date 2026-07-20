import "server-only";

import { randomUUID } from "node:crypto";

import {
  PublicNonEnumeratingAcceptedResponseSchema,
  PublicSubscribeCommandSchema,
} from "@/lib/domain/schemas/index.ts";
import { requestFingerprint } from "./bookingSecurity.ts";
import {
  evaluatePublicAbuseGuard,
  publicAbuseRejectionResponse,
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

const PATH = "/api/newsletter/subscribe";
const BodySchema = PublicSubscribeCommandSchema.omit({ idempotencyKey: true });

function accepted(): Response {
  return validatedJsonResponse(
    PublicNonEnumeratingAcceptedResponseSchema,
    { code: "REQUEST_ACCEPTED" },
    202,
  );
}

interface SubscribeRepository {
  subscribe(input: {
    principalScopeHash: Buffer;
    requestFingerprint: Buffer;
    command: {
      idempotencyKey: string;
      email: string;
      consent: true;
    };
  }): Promise<unknown>;
}

export function createPublicNewsletterSubscribePostHandler({
  repository,
  abuseGuard,
  createRequestId = randomUUID,
}: {
  readonly repository: SubscribeRepository;
  readonly abuseGuard: PublicAbuseGuard;
  readonly createRequestId?: () => string;
}) {
  return async function POST(request: Request): Promise<Response> {
    const requestId = createRequestId();
    const framing = validatePublicNewsletterRequest(request, { path: PATH });
    if (!framing.ok) {
      return apiErrorResponse(framing.status, framing.code, requestId);
    }

    const abuse = await evaluatePublicAbuseGuard(
      abuseGuard,
      request,
      "public_newsletter_subscribe",
    );
    if (!abuse.ok) return publicAbuseRejectionResponse(abuse, requestId);

    const body = await readPublicNewsletterBody(request, BodySchema);
    if (!body.ok) return apiErrorResponse(body.status, body.code, requestId);
    const command = PublicSubscribeCommandSchema.parse({
      ...body.body,
      idempotencyKey: framing.idempotencyKey,
    });
    const accountAbuse = await evaluatePublicAbuseGuard(
      abuseGuard,
      request,
      "public_newsletter_subscribe",
      {
        kind: "account",
        value: command.email,
        humanVerified: abuse.humanVerified,
      },
    );
    if (!accountAbuse.ok) return accepted();

    try {
      const result = await repository.subscribe({
        principalScopeHash: Buffer.from(abuse.principalScopeHash),
        requestFingerprint: requestFingerprint({
          operation: "public_newsletter_subscribe",
          version: 1,
          request: body.body,
        }),
        command,
      });
      if (
        !result ||
        typeof result !== "object" ||
        (result as { httpStatus?: unknown }).httpStatus !== 202 ||
        (result as { code?: unknown }).code !== "REQUEST_ACCEPTED"
      ) {
        return apiErrorResponse(503, "SERVICE_UNAVAILABLE", requestId);
      }
      return accepted();
    } catch (error) {
      return databaseErrorResponse(error, requestId);
    }
  };
}

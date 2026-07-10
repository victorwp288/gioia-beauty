import "server-only";

import { randomUUID } from "node:crypto";

import { z } from "zod";

import { validateEnvironment } from "@/config/environment.mjs";
import { UuidSchema } from "@/lib/domain/schemas/index.ts";
import {
  verifiedEmailWebhookRepository,
  type VerifiedEmailWebhookRepository,
} from "@/lib/server/database/verifiedEmailWebhookRepository.ts";
import {
  apiErrorResponse,
  validatedJsonResponse,
} from "@/lib/server/publicApiResponse.ts";

import { verifyResendWebhookRequest } from "./resendWebhookRequest.ts";
import {
  createResendWebhookVerifier,
  type ResendWebhookVerifier,
} from "./resendWebhookVerifier.ts";

const AcceptedWebhookResponseSchema = z
  .object({
    code: z.literal("REQUEST_ACCEPTED"),
    requestId: UuidSchema,
    replayed: z.boolean(),
  })
  .strict();

interface HandlerOptions {
  readonly repository?: Pick<VerifiedEmailWebhookRepository, "processVerified">;
  readonly env?: Readonly<Record<string, string | undefined>>;
  readonly verifierFactory?: (
    secret: string | undefined,
  ) => ResendWebhookVerifier;
  readonly now?: () => Date;
  readonly requestId?: () => string;
  readonly allowSyntheticTestRuntime?: boolean;
}

function productionWebhookRuntimeIsValid(
  env: Readonly<Record<string, string | undefined>>,
) {
  const validation = validateEnvironment(env);
  return (
    validation.ok &&
    validation.appEnv === "production" &&
    env.VERCEL_ENV === "production" &&
    env.EMAIL_WEBHOOK_ENABLED === "true"
  );
}

function webhookConflict(error: unknown) {
  if (!error || typeof error !== "object") return false;
  const candidate = error as { code?: unknown; message?: unknown };
  return (
    candidate.code === "PT409" &&
    candidate.message === "WEBHOOK_EVENT_ID_REUSED"
  );
}

export function createResendWebhookPostHandler({
  repository = verifiedEmailWebhookRepository,
  env = process.env,
  verifierFactory = createResendWebhookVerifier,
  now = () => new Date(),
  requestId = randomUUID,
  allowSyntheticTestRuntime = false,
}: HandlerOptions = {}) {
  return async function resendWebhookPost(request: Request): Promise<Response> {
    const id = requestId();
    if (!allowSyntheticTestRuntime && !productionWebhookRuntimeIsValid(env)) {
      return apiErrorResponse(503, "SERVICE_UNAVAILABLE", id);
    }

    let verifier: ResendWebhookVerifier;
    try {
      verifier = verifierFactory(env.RESEND_WEBHOOK_SECRET);
    } catch {
      return apiErrorResponse(503, "SERVICE_UNAVAILABLE", id);
    }

    const verified = await verifyResendWebhookRequest({
      request,
      verifier,
      now,
    });
    if (!verified.ok) {
      return apiErrorResponse(verified.status, verified.code, id);
    }

    try {
      const result = await repository.processVerified(verified.event);
      if (result.processingState === "error") {
        return result.errorCode === "PROVIDER_MESSAGE_NOT_FOUND"
          ? apiErrorResponse(503, "WEBHOOK_MESSAGE_PENDING", id)
          : apiErrorResponse(400, "INVALID_WEBHOOK", id);
      }
      const headers = new Headers({ "X-Request-Id": id });
      return validatedJsonResponse(
        AcceptedWebhookResponseSchema,
        { code: "REQUEST_ACCEPTED", requestId: id, replayed: result.replayed },
        200,
        headers,
      );
    } catch (error) {
      return webhookConflict(error)
        ? apiErrorResponse(409, "WEBHOOK_EVENT_CONFLICT", id)
        : apiErrorResponse(503, "SERVICE_UNAVAILABLE", id);
    }
  };
}

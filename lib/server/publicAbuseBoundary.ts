import "server-only";

import { z } from "zod";

import { validateEnvironment } from "@/config/environment.mjs";

import { requestPrincipalScopeHash } from "./bookingSecurity.ts";
import { apiErrorResponse } from "./publicApiResponse.ts";

export type PublicAbuseAction = "public_availability" | "public_booking";

export type PublicAbuseAllowed = {
  readonly ok: true;
  readonly principalScopeHash: Buffer;
};

export type PublicAbuseRejection =
  | {
      readonly ok: false;
      readonly status: 403;
      readonly code: "HUMAN_VERIFICATION_REQUIRED";
    }
  | {
      readonly ok: false;
      readonly status: 429;
      readonly code: "RATE_LIMITED";
      readonly retryAfterSeconds: number;
    }
  | {
      readonly ok: false;
      readonly status: 503;
      readonly code: "SERVICE_UNAVAILABLE";
    };

export type PublicAbuseDecision = PublicAbuseAllowed | PublicAbuseRejection;

export interface PublicAbuseRequestMetadata {
  readonly headers: Headers;
}

export interface PublicAbuseGuard {
  check(
    request: PublicAbuseRequestMetadata,
    action: PublicAbuseAction,
  ): Promise<unknown>;
}

type ServerEnvironment = Readonly<Record<string, string | undefined>>;

const PrincipalScopeHashSchema = z
  .custom<Buffer>(
    (value) => Buffer.isBuffer(value) && value.byteLength === 32,
    "Expected a 32-byte principal scope hash",
  )
  .transform((value) => Buffer.from(value));

const PublicAbuseDecisionSchema = z.union([
  z
    .object({
      ok: z.literal(true),
      principalScopeHash: PrincipalScopeHashSchema,
    })
    .strict(),
  z
    .object({
      ok: z.literal(false),
      status: z.literal(403),
      code: z.literal("HUMAN_VERIFICATION_REQUIRED"),
    })
    .strict(),
  z
    .object({
      ok: z.literal(false),
      status: z.literal(429),
      code: z.literal("RATE_LIMITED"),
      retryAfterSeconds: z.number().int().min(1).max(3_600),
    })
    .strict(),
  z
    .object({
      ok: z.literal(false),
      status: z.literal(503),
      code: z.literal("SERVICE_UNAVAILABLE"),
    })
    .strict(),
]);

function unavailableDecision(): PublicAbuseRejection {
  return { ok: false, status: 503, code: "SERVICE_UNAVAILABLE" };
}

function isPublicAbuseAction(action: unknown): action is PublicAbuseAction {
  return action === "public_availability" || action === "public_booking";
}

export async function evaluatePublicAbuseGuard(
  guard: PublicAbuseGuard,
  request: Request,
  action: PublicAbuseAction,
): Promise<PublicAbuseDecision> {
  try {
    const requestMetadata = Object.freeze({
      headers: new Headers(request.headers),
    });
    const parsed = PublicAbuseDecisionSchema.safeParse(
      await guard.check(requestMetadata, action),
    );
    if (!parsed.success) return unavailableDecision();
    if (!parsed.data.ok) return { ...parsed.data };
    return {
      ok: true,
      principalScopeHash: Buffer.from(parsed.data.principalScopeHash),
    };
  } catch {
    return unavailableDecision();
  }
}

export function publicAbuseRejectionResponse(
  decision: PublicAbuseRejection,
  requestId: string,
): Response {
  const headers = new Headers();
  if (decision.status === 429) {
    headers.set("Retry-After", String(decision.retryAfterSeconds));
  }
  return apiErrorResponse(decision.status, decision.code, requestId, headers);
}

export function createPublicAbuseGuard(
  env: ServerEnvironment = process.env,
): PublicAbuseGuard {
  return {
    async check(request, action) {
      try {
        const validation = validateEnvironment(env);
        if (
          !validation.ok ||
          (validation.appEnv !== "local" && validation.appEnv !== "test") ||
          !isPublicAbuseAction(action)
        ) {
          return unavailableDecision();
        }

        return {
          ok: true,
          principalScopeHash: requestPrincipalScopeHash(request, env),
        };
      } catch {
        return unavailableDecision();
      }
    },
  };
}

export const publicAbuseGuard = createPublicAbuseGuard();

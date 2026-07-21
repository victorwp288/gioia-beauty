import "server-only";

import { createHmac, timingSafeEqual } from "node:crypto";
import { z } from "zod";

import { validateEnvironment } from "@/config/environment.mjs";
import {
  NormalizedEmailSchema,
  UuidSchema,
} from "@/lib/domain/schemas/index.ts";

import {
  hmacPrincipalScope,
  requestPrincipalScopeHash,
  resolveBookingHmacSecret,
} from "./bookingSecurity.ts";
import {
  publicAbuseRepository,
  type PublicAbuseRepository,
} from "./database/publicAbuseRepository.ts";
import { apiErrorResponse } from "./publicApiResponse.ts";

export type PublicAbuseAction =
  | "public_availability"
  | "public_booking"
  | "public_newsletter_subscribe"
  | "public_newsletter_confirm"
  | "public_newsletter_unsubscribe"
  | "owner_login";

export type PublicAbuseAllowed = {
  readonly ok: true;
  readonly principalScopeHash: Buffer;
  readonly humanVerified: boolean;
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

export type PublicAbuseScope = Readonly<
  | { kind: "account"; value: string; humanVerified: boolean }
  | { kind: "token"; value: string; humanVerified: boolean }
>;

export interface PublicAbuseRequestMetadata {
  readonly headers: Headers;
}

export interface PublicAbuseGuard {
  check(
    request: PublicAbuseRequestMetadata,
    action: PublicAbuseAction,
    scope?: PublicAbuseScope,
  ): Promise<unknown>;
}

export interface PublicHumanChallengeVerifier {
  verify(
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
const HumanChallengeDecisionSchema = z
  .object({ verified: z.boolean() })
  .strict();
const HUMAN_CHALLENGE_HEADER = "x-gioia-human-challenge";
const HUMAN_CHALLENGE_TOKEN_PATTERN = /^[A-Za-z0-9_-]{43}$/;

const PublicAbuseDecisionSchema = z.union([
  z.union([
    z
      .object({
        ok: z.literal(true),
        principalScopeHash: PrincipalScopeHashSchema,
      })
      .strict(),
    z
      .object({
        ok: z.literal(true),
        principalScopeHash: PrincipalScopeHashSchema,
        humanVerified: z.boolean(),
      })
      .strict(),
  ]),
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
      retryAfterSeconds: z.number().int().min(1).max(86_400),
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
  return [
    "public_availability",
    "public_booking",
    "public_newsletter_subscribe",
    "public_newsletter_confirm",
    "public_newsletter_unsubscribe",
    "owner_login",
  ].includes(action as PublicAbuseAction);
}

function actionEnabledInEnvironment(
  appEnv: string,
  action: PublicAbuseAction,
): boolean {
  if (appEnv === "local" || appEnv === "test") return true;
  return (
    action === "owner_login" &&
    (appEnv === "preview" || appEnv === "production")
  );
}

function validScopeForAction(
  action: PublicAbuseAction,
  scope: PublicAbuseScope | undefined,
): boolean {
  if (scope === undefined) return true;
  return (
    (scope.kind === "account" &&
      (action === "public_booking" ||
        action === "public_newsletter_subscribe" ||
        action === "owner_login")) ||
    (scope.kind === "token" &&
      (action === "public_newsletter_confirm" ||
        action === "public_newsletter_unsubscribe"))
  );
}

function scopedPrincipalHash(
  scope: PublicAbuseScope,
  env: ServerEnvironment,
): Buffer {
  const value =
    scope.kind === "account"
      ? NormalizedEmailSchema.parse(scope.value)
      : UuidSchema.parse(scope.value);
  if (value !== scope.value) throw new TypeError("Invalid abuse scope");
  return createHmac("sha256", resolveBookingHmacSecret(env))
    .update("gioia:public-abuse-scope:v1\0", "utf8")
    .update(`${scope.kind}:${value}`, "utf8")
    .digest();
}

function canonicalChallengeToken(value: unknown): Buffer | null {
  if (typeof value !== "string" || !HUMAN_CHALLENGE_TOKEN_PATTERN.test(value)) {
    return null;
  }
  const bytes = Buffer.from(value, "base64url");
  return bytes.length === 32 && bytes.toString("base64url") === value
    ? bytes
    : null;
}

async function verifiedHumanChallenge(
  verifier: PublicHumanChallengeVerifier,
  request: PublicAbuseRequestMetadata,
  action: PublicAbuseAction,
): Promise<boolean> {
  try {
    const parsed = HumanChallengeDecisionSchema.safeParse(
      await verifier.verify(request, action),
    );
    return parsed.success && parsed.data.verified;
  } catch {
    return false;
  }
}

export async function evaluatePublicAbuseGuard(
  guard: PublicAbuseGuard,
  request: Request,
  action: PublicAbuseAction,
  scope?: PublicAbuseScope,
): Promise<PublicAbuseDecision> {
  try {
    const requestMetadata = Object.freeze({
      headers: new Headers(request.headers),
    });
    const parsed = PublicAbuseDecisionSchema.safeParse(
      await (scope === undefined
        ? guard.check(requestMetadata, action)
        : guard.check(requestMetadata, action, scope)),
    );
    if (!parsed.success) return unavailableDecision();
    if (!parsed.data.ok) return { ...parsed.data };
    return {
      ok: true,
      principalScopeHash: Buffer.from(parsed.data.principalScopeHash),
      humanVerified:
        "humanVerified" in parsed.data ? parsed.data.humanVerified : false,
    };
  } catch {
    return unavailableDecision();
  }
}

export function publicAbuseRejectionResponse(
  decision: PublicAbuseRejection,
  requestId: string,
  responseHeaders: HeadersInit = {},
): Response {
  const headers = new Headers(responseHeaders);
  if (decision.status === 429) {
    headers.set("Retry-After", String(decision.retryAfterSeconds));
  }
  return apiErrorResponse(decision.status, decision.code, requestId, headers);
}

export function createPublicAbuseGuard(
  env: ServerEnvironment = process.env,
): PublicAbuseGuard {
  return {
    async check(request, action, scope) {
      try {
        const validation = validateEnvironment(env);
        if (
          !validation.ok ||
          !isPublicAbuseAction(action) ||
          !actionEnabledInEnvironment(validation.appEnv, action) ||
          !validScopeForAction(action, scope)
        ) {
          return unavailableDecision();
        }

        return {
          ok: true,
          principalScopeHash:
            scope === undefined
              ? requestPrincipalScopeHash(request, env)
              : scopedPrincipalHash(scope, env),
          humanVerified: scope?.humanVerified ?? false,
        };
      } catch {
        return unavailableDecision();
      }
    },
  };
}

export function createLocalTestHumanChallengeVerifier(
  env: ServerEnvironment = process.env,
): PublicHumanChallengeVerifier {
  return {
    async verify(request) {
      try {
        const validation = validateEnvironment(env);
        if (
          !validation.ok ||
          (validation.appEnv !== "local" && validation.appEnv !== "test")
        ) {
          return { verified: false };
        }
        const expected = canonicalChallengeToken(
          env.PUBLIC_HUMAN_CHALLENGE_TEST_TOKEN,
        );
        const supplied = canonicalChallengeToken(
          request.headers.get(HUMAN_CHALLENGE_HEADER),
        );
        if (!expected || !supplied) {
          return { verified: false };
        }
        return {
          verified: timingSafeEqual(supplied, expected),
        };
      } catch {
        return { verified: false };
      }
    },
  };
}

export function createDatabasePublicAbuseGuard(
  repository: Pick<PublicAbuseRepository, "consume"> = publicAbuseRepository,
  env: ServerEnvironment = process.env,
  humanChallengeVerifier: PublicHumanChallengeVerifier = createLocalTestHumanChallengeVerifier(
    env,
  ),
): PublicAbuseGuard {
  return {
    async check(request, action, scope) {
      const validation = validateEnvironment(env);
      if (
        !validation.ok ||
        !isPublicAbuseAction(action) ||
        !actionEnabledInEnvironment(validation.appEnv, action) ||
        !validScopeForAction(action, scope)
      ) {
        return unavailableDecision();
      }

      const principalScopeHash =
        scope === undefined
          ? requestPrincipalScopeHash(request, env)
          : scopedPrincipalHash(scope, env);
      const humanVerified =
        scope === undefined
          ? action === "public_booking" ||
            action === "public_newsletter_subscribe"
            ? await verifiedHumanChallenge(
                humanChallengeVerifier,
                request,
                action,
              )
            : false
          : scope.humanVerified;
      const result = await repository.consume({
        action,
        scopeKind: scope?.kind ?? "network",
        scopeHash: principalScopeHash,
        humanVerified,
      });
      if (result.allowed && result.decision === "allowed") {
        return { ok: true, principalScopeHash, humanVerified };
      }
      if (
        result.decision === "human_verification_required" &&
        result.humanVerificationRequired
      ) {
        if (action === "owner_login" && result.retryAfterSeconds > 0) {
          return {
            ok: false,
            status: 429,
            code: "RATE_LIMITED",
            retryAfterSeconds: result.retryAfterSeconds,
          };
        }
        return {
          ok: false,
          status: 403,
          code: "HUMAN_VERIFICATION_REQUIRED",
        };
      }
      if (result.decision === "rate_limited" && result.retryAfterSeconds > 0) {
        return {
          ok: false,
          status: 429,
          code: "RATE_LIMITED",
          retryAfterSeconds: result.retryAfterSeconds,
        };
      }
      return unavailableDecision();
    },
  };
}

export const publicAbuseGuard = createDatabasePublicAbuseGuard();

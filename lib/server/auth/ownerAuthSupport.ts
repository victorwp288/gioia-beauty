import "server-only";

import { z } from "zod";

import {
  apiErrorResponse,
  validatedJsonResponse,
} from "../publicApiResponse.ts";
import type { SupabaseAuthFailure } from "./authFailure.ts";
import type { OwnerAuthVerifier } from "./freshOwnerSession.ts";

export const LoginResponseSchema = z
  .object({
    code: z.literal("OWNER_SESSION_CREATED"),
    csrfToken: z.string().regex(/^[A-Za-z0-9_-]{43}$/),
  })
  .strict();
export const SessionResponseSchema = z
  .object({
    code: z.literal("OWNER_SESSION_ACTIVE"),
    csrfToken: z.string().regex(/^[A-Za-z0-9_-]{43}$/),
  })
  .strict();
export const LogoutResponseSchema = z
  .object({ code: z.literal("OWNER_SESSION_ENDED") })
  .strict();

export interface OwnerAuthActions extends OwnerAuthVerifier {
  signInWithPassword(credentials: {
    email: string;
    password: string;
  }): PromiseLike<{ error: unknown }>;
  signOut(options: { scope: "local" }): PromiseLike<{ error: unknown }>;
}

export interface SecurityCookieWriter {
  set(tokens: { bindingToken: string; csrfToken: string }): void;
  clear(): void;
}

export function authFailureResponse(
  failure: SupabaseAuthFailure,
  invalidCode: "INVALID_CREDENTIALS" | "OWNER_SESSION_REQUIRED",
  responseHeaders: HeadersInit,
) {
  if (failure === "rate_limited") {
    return apiErrorResponse(429, "RATE_LIMITED", undefined, {
      ...Object.fromEntries(new Headers(responseHeaders)),
      "Retry-After": "60",
    });
  }
  if (failure === "unavailable") {
    return apiErrorResponse(
      503,
      "SERVICE_UNAVAILABLE",
      undefined,
      responseHeaders,
    );
  }
  return apiErrorResponse(401, invalidCode, undefined, responseHeaders);
}

export async function clearSignedInState(
  auth: Pick<OwnerAuthActions, "signOut">,
  securityCookies: Pick<SecurityCookieWriter, "clear">,
) {
  securityCookies.clear();
  try {
    await auth.signOut({ scope: "local" });
  } catch {
    // The binding cookie is already gone, so business authorization fails closed.
  }
}

export function loginSuccessResponse(
  csrfToken: string,
  responseHeaders: HeadersInit,
) {
  return validatedJsonResponse(
    LoginResponseSchema,
    { code: "OWNER_SESSION_CREATED", csrfToken },
    200,
    responseHeaders,
  );
}

export function sessionSuccessResponse(
  csrfToken: string,
  responseHeaders: HeadersInit,
) {
  return validatedJsonResponse(
    SessionResponseSchema,
    { code: "OWNER_SESSION_ACTIVE", csrfToken },
    200,
    responseHeaders,
  );
}

export function logoutSuccessResponse(responseHeaders: HeadersInit) {
  return validatedJsonResponse(
    LogoutResponseSchema,
    { code: "OWNER_SESSION_ENDED" },
    200,
    responseHeaders,
  );
}

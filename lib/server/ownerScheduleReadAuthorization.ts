import "server-only";

import { UuidSchema } from "@/lib/domain/schemas/index.ts";

import type { OwnerAuthorizationDecision } from "./auth/freshOwnerSession.ts";
import { exactDataObject } from "./exactData.ts";

export function exactOwnerReadIdentityResult(candidate: unknown):
  | Readonly<{ ok: true; userId: string; sessionId: string }>
  | Readonly<{
      ok: false;
      status: 401 | 403 | 429 | 503;
      code:
        | "OWNER_SESSION_REQUIRED"
        | "OWNER_AUTHORIZATION_REQUIRED"
        | "RATE_LIMITED"
        | "SERVICE_UNAVAILABLE";
    }>
  | null {
  const success = exactDataObject(candidate, ["ok", "userId", "sessionId"]);
  if (success?.ok === true) {
    const userId = UuidSchema.safeParse(success.userId);
    const sessionId = UuidSchema.safeParse(success.sessionId);
    if (
      userId.success &&
      sessionId.success &&
      userId.data === success.userId &&
      sessionId.data === success.sessionId
    ) {
      return { ok: true, userId: userId.data, sessionId: sessionId.data };
    }
  }
  const failure = exactDataObject(candidate, ["ok", "status", "code"]);
  if (failure?.ok !== false) return null;
  if (failure.status === 401 && failure.code === "OWNER_SESSION_REQUIRED") {
    return { ok: false, status: 401, code: "OWNER_SESSION_REQUIRED" };
  }
  if (
    failure.status === 403 &&
    failure.code === "OWNER_AUTHORIZATION_REQUIRED"
  ) {
    return { ok: false, status: 403, code: "OWNER_AUTHORIZATION_REQUIRED" };
  }
  if (failure.status === 429 && failure.code === "RATE_LIMITED") {
    return { ok: false, status: 429, code: "RATE_LIMITED" };
  }
  if (failure.status === 503 && failure.code === "SERVICE_UNAVAILABLE") {
    return { ok: false, status: 503, code: "SERVICE_UNAVAILABLE" };
  }
  return null;
}

export function exactOwnerReadAuthorizationDecision(
  candidate: unknown,
): OwnerAuthorizationDecision {
  const success = exactDataObject(candidate, ["ok"]);
  if (success?.ok === true) return { ok: true };
  const failure = exactDataObject(candidate, ["ok", "status", "code"]);
  if (
    failure?.ok === false &&
    failure.status === 401 &&
    failure.code === "OWNER_SESSION_REQUIRED"
  ) {
    return { ok: false, status: 401, code: "OWNER_SESSION_REQUIRED" };
  }
  if (
    failure?.ok === false &&
    failure.status === 403 &&
    failure.code === "OWNER_AUTHORIZATION_REQUIRED"
  ) {
    return { ok: false, status: 403, code: "OWNER_AUTHORIZATION_REQUIRED" };
  }
  throw new TypeError("Owner authorization decision is invalid");
}

export function classifyOwnerReadExecutorAuthError(error: unknown): Readonly<{
  status: 401 | 403 | 503;
  code:
    | "OWNER_SESSION_REQUIRED"
    | "OWNER_AUTHORIZATION_REQUIRED"
    | "SERVICE_UNAVAILABLE";
}> {
  try {
    if (!error || typeof error !== "object") throw new TypeError();
    const fields = error as Record<string, unknown>;
    if (
      fields.code === "PT401" &&
      [
        "OWNER_AUTHENTICATION_REQUIRED",
        "OWNER_SESSION_EXPIRED",
        "OWNER_SESSION_REQUIRED",
        "OWNER_SESSION_REVOKED",
      ].includes(fields.message as string)
    ) {
      return { status: 401, code: "OWNER_SESSION_REQUIRED" };
    }
    if (
      fields.code === "PT403" &&
      [
        "OWNER_AUTHORIZATION_REQUIRED",
        "OWNER_IDENTITY_MISMATCH",
        "OWNER_SESSION_MISMATCH",
      ].includes(fields.message as string)
    ) {
      return { status: 403, code: "OWNER_AUTHORIZATION_REQUIRED" };
    }
  } catch {
    // Every hostile or unknown error is unavailable.
  }
  return { status: 503, code: "SERVICE_UNAVAILABLE" };
}

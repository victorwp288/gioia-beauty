import "server-only";

import { z } from "zod";

import {
  classifySupabaseAuthError,
  type SupabaseAuthFailure,
} from "./authFailure.ts";
import { verifyOwnerSessionBinding } from "./sessionBinding.ts";

const MAX_ACCESS_TOKEN_BYTES = 16 * 1_024;
const AccessTokenClaimsSchema = z
  .object({
    sub: z.string().uuid(),
    session_id: z.string().uuid(),
  })
  .passthrough();

interface AuthSessionResult {
  data: { session: { access_token: string } | null };
  error: unknown;
}

interface AuthUserResult {
  data: { user: { id: string } | null };
  error: unknown;
}

export interface OwnerAuthVerifier {
  getSession(): PromiseLike<AuthSessionResult>;
  getUser(accessToken: string): PromiseLike<AuthUserResult>;
}

export interface FreshSupabaseIdentity {
  userId: string;
  sessionId: string;
}

export type FreshSupabaseIdentityResult =
  | ({ ok: true } & FreshSupabaseIdentity)
  | { ok: false; failure: SupabaseAuthFailure };

export type FreshBoundOwnerIdentityResult =
  | ({ ok: true } & FreshSupabaseIdentity)
  | { ok: false; status: 401; code: "OWNER_SESSION_REQUIRED" }
  | { ok: false; status: 429; code: "RATE_LIMITED" }
  | { ok: false; status: 503; code: "SERVICE_UNAVAILABLE" };

export type OwnerAuthorizationDecision =
  | { ok: true }
  | {
      ok: false;
      status: 401 | 403;
      code: "OWNER_SESSION_REQUIRED" | "OWNER_AUTHORIZATION_REQUIRED";
    };

export type OwnerSessionResult =
  | ({ ok: true } & FreshSupabaseIdentity)
  | {
      ok: false;
      status: 401 | 403 | 429 | 503;
      code:
        | "OWNER_SESSION_REQUIRED"
        | "OWNER_AUTHORIZATION_REQUIRED"
        | "RATE_LIMITED"
        | "SERVICE_UNAVAILABLE";
    };

function boundIdentityFailure(
  failure: SupabaseAuthFailure,
): Extract<FreshBoundOwnerIdentityResult, { ok: false }> {
  if (failure === "rate_limited") {
    return { ok: false, status: 429, code: "RATE_LIMITED" };
  }
  if (failure === "unavailable") {
    return { ok: false, status: 503, code: "SERVICE_UNAVAILABLE" };
  }
  return { ok: false, status: 401, code: "OWNER_SESSION_REQUIRED" };
}

function accessTokenClaims(
  token: string,
): z.infer<typeof AccessTokenClaimsSchema> | null {
  if (
    Buffer.byteLength(token, "utf8") > MAX_ACCESS_TOKEN_BYTES ||
    token.split(".").length !== 3
  ) {
    return null;
  }
  const encodedPayload = token.split(".")[1];
  if (!encodedPayload) return null;

  try {
    const payload = Buffer.from(encodedPayload, "base64url");
    if (payload.toString("base64url") !== encodedPayload) return null;
    const parsed = AccessTokenClaimsSchema.safeParse(
      JSON.parse(payload.toString("utf8")),
    );
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}

export async function getFreshSupabaseIdentity(
  auth: OwnerAuthVerifier,
): Promise<FreshSupabaseIdentityResult> {
  const sessionResult = await auth.getSession();
  const accessToken = sessionResult.data.session?.access_token;
  if (sessionResult.error) {
    return {
      ok: false,
      failure: classifySupabaseAuthError(sessionResult.error),
    };
  }
  if (!accessToken) return { ok: false, failure: "invalid" };

  const userResult = await auth.getUser(accessToken);
  if (userResult.error) {
    return {
      ok: false,
      failure: classifySupabaseAuthError(userResult.error),
    };
  }
  if (!userResult.data.user) return { ok: false, failure: "invalid" };

  const claims = accessTokenClaims(accessToken);
  if (!claims || claims.sub !== userResult.data.user.id) {
    return { ok: false, failure: "invalid" };
  }
  return {
    ok: true,
    userId: claims.sub,
    sessionId: claims.session_id,
  };
}

export async function requireFreshBoundOwnerIdentity({
  auth,
  bindingToken,
  bindingSecret,
  now = new Date(),
}: {
  auth: OwnerAuthVerifier;
  bindingToken: string | null | undefined;
  bindingSecret: string;
  now?: Date;
}): Promise<FreshBoundOwnerIdentityResult> {
  let identity: FreshSupabaseIdentityResult;
  try {
    identity = await getFreshSupabaseIdentity(auth);
  } catch {
    return boundIdentityFailure("unavailable");
  }
  if (!identity.ok) return boundIdentityFailure(identity.failure);

  try {
    const binding = verifyOwnerSessionBinding({
      token: bindingToken,
      expectedUserId: identity.userId,
      expectedSessionId: identity.sessionId,
      secret: bindingSecret,
      now,
    });
    return binding ? identity : boundIdentityFailure("invalid");
  } catch {
    return boundIdentityFailure("unavailable");
  }
}

export async function requireFreshOwnerSession({
  auth,
  bindingToken,
  bindingSecret,
  authorizeSession,
  now = new Date(),
}: {
  auth: OwnerAuthVerifier;
  bindingToken: string | null | undefined;
  bindingSecret: string;
  authorizeSession: (
    identity: FreshSupabaseIdentity,
  ) => Promise<OwnerAuthorizationDecision>;
  now?: Date;
}): Promise<OwnerSessionResult> {
  const identity = await requireFreshBoundOwnerIdentity({
    auth,
    bindingToken,
    bindingSecret,
    now,
  });
  if (!identity.ok) return identity;

  const authorization = await authorizeSession({
    userId: identity.userId,
    sessionId: identity.sessionId,
  });
  if (!authorization.ok) return authorization;
  return {
    ok: true,
    userId: identity.userId,
    sessionId: identity.sessionId,
  };
}

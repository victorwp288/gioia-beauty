import "server-only";

import { randomUUID } from "node:crypto";

import { apiErrorResponse } from "../publicApiResponse.ts";
import {
  evaluatePublicAbuseGuard,
  publicAbuseRejectionResponse,
  type PublicAbuseGuard,
} from "../publicAbuseBoundary.ts";
import { classifySupabaseAuthError } from "./authFailure.ts";
import {
  getFreshSupabaseIdentity,
  requireFreshOwnerSession,
  type FreshSupabaseIdentity,
  type OwnerAuthorizationDecision,
  type OwnerAuthVerifier,
} from "./freshOwnerSession.ts";
import { readBoundedLoginBody } from "./loginRequest.ts";
import {
  issueOwnerCsrfToken,
  requestHasExpectedOrigin,
  validOwnerCsrfToken,
} from "./requestSecurity.ts";
import {
  issueOwnerSessionBinding,
  verifyOwnerSessionBinding,
} from "./sessionBinding.ts";
import {
  authFailureResponse,
  clearSignedInState,
  loginSuccessResponse,
  logoutSuccessResponse,
  sessionSuccessResponse,
  type OwnerAuthActions,
  type SecurityCookieWriter,
} from "./ownerAuthSupport.ts";

export function createOwnerLoginHandler({
  auth,
  abuseGuard,
  bindingSecret,
  startSession,
  revokeSession,
  securityCookies,
  responseHeaders = {},
}: {
  auth: OwnerAuthActions;
  abuseGuard: PublicAbuseGuard;
  bindingSecret: string;
  startSession: (
    identity: FreshSupabaseIdentity,
  ) => Promise<OwnerAuthorizationDecision>;
  revokeSession: (identity: FreshSupabaseIdentity) => Promise<boolean>;
  securityCookies: SecurityCookieWriter;
  responseHeaders?: HeadersInit;
}) {
  return async function POST(request: Request): Promise<Response> {
    if (!requestHasExpectedOrigin(request)) {
      return apiErrorResponse(
        403,
        "FORBIDDEN_ORIGIN",
        undefined,
        responseHeaders,
      );
    }
    if (new URL(request.url).search !== "") {
      return apiErrorResponse(
        400,
        "INVALID_REQUEST",
        undefined,
        responseHeaders,
      );
    }
    const body = await readBoundedLoginBody(request);
    if (!body.ok) {
      return apiErrorResponse(
        body.status,
        body.code,
        undefined,
        responseHeaders,
      );
    }

    const requestId = randomUUID();
    const networkAbuse = await evaluatePublicAbuseGuard(
      abuseGuard,
      request,
      "owner_login",
    );
    if (!networkAbuse.ok) {
      return publicAbuseRejectionResponse(
        networkAbuse,
        requestId,
        responseHeaders,
      );
    }
    const accountAbuse = await evaluatePublicAbuseGuard(
      abuseGuard,
      request,
      "owner_login",
      {
        kind: "account",
        value: body.body.email,
        humanVerified: networkAbuse.humanVerified,
      },
    );
    if (!accountAbuse.ok) {
      return publicAbuseRejectionResponse(
        accountAbuse,
        requestId,
        responseHeaders,
      );
    }

    let startedIdentity: FreshSupabaseIdentity | null = null;
    try {
      const signIn = await auth.signInWithPassword(body.body);
      if (signIn.error) {
        await clearSignedInState(auth, securityCookies);
        return authFailureResponse(
          classifySupabaseAuthError(signIn.error),
          "INVALID_CREDENTIALS",
          responseHeaders,
        );
      }
      const identity = await getFreshSupabaseIdentity(auth);
      if (!identity.ok) {
        await clearSignedInState(auth, securityCookies);
        return authFailureResponse(
          identity.failure,
          "INVALID_CREDENTIALS",
          responseHeaders,
        );
      }
      const freshIdentity = {
        userId: identity.userId,
        sessionId: identity.sessionId,
      };
      const started = await startSession(freshIdentity);
      if (!started.ok) {
        await clearSignedInState(auth, securityCookies);
        return apiErrorResponse(
          started.status,
          started.code,
          undefined,
          responseHeaders,
        );
      }
      startedIdentity = freshIdentity;

      const csrfToken = issueOwnerCsrfToken();
      securityCookies.set({
        bindingToken: issueOwnerSessionBinding({
          ...freshIdentity,
          secret: bindingSecret,
        }),
        csrfToken,
      });
      return loginSuccessResponse(csrfToken, responseHeaders);
    } catch {
      if (startedIdentity) {
        try {
          await revokeSession(startedIdentity);
        } catch {
          // The client binding is still cleared below; the orphan expires in 12h.
        }
      }
      await clearSignedInState(auth, securityCookies);
      return apiErrorResponse(
        503,
        "SERVICE_UNAVAILABLE",
        undefined,
        responseHeaders,
      );
    }
  };
}

export function createOwnerSessionHandler({
  auth,
  bindingToken,
  bindingSecret,
  csrfToken,
  authorizeSession,
  securityCookies,
  responseHeaders = {},
}: {
  auth: OwnerAuthVerifier & Pick<OwnerAuthActions, "signOut">;
  bindingToken: string | null | undefined;
  bindingSecret: string;
  csrfToken: string | null | undefined;
  authorizeSession: (
    identity: FreshSupabaseIdentity,
  ) => Promise<OwnerAuthorizationDecision>;
  securityCookies: Pick<SecurityCookieWriter, "clear">;
  responseHeaders?: HeadersInit;
}) {
  return async function GET(request: Request): Promise<Response> {
    if (new URL(request.url).search !== "") {
      return apiErrorResponse(
        400,
        "INVALID_REQUEST",
        undefined,
        responseHeaders,
      );
    }
    try {
      const result = await requireFreshOwnerSession({
        auth,
        bindingToken,
        bindingSecret,
        authorizeSession,
      });
      if (!result.ok) {
        if (result.status === 401 || result.status === 403) {
          await clearSignedInState(auth, securityCookies);
        }
        if (result.status === 429) {
          return authFailureResponse(
            "rate_limited",
            "OWNER_SESSION_REQUIRED",
            responseHeaders,
          );
        }
        return apiErrorResponse(
          result.status,
          result.code,
          undefined,
          responseHeaders,
        );
      }
      if (!csrfToken || !validOwnerCsrfToken(csrfToken, csrfToken)) {
        await clearSignedInState(auth, securityCookies);
        return apiErrorResponse(
          401,
          "OWNER_SESSION_REQUIRED",
          undefined,
          responseHeaders,
        );
      }
      return sessionSuccessResponse(csrfToken, responseHeaders);
    } catch {
      return apiErrorResponse(
        503,
        "SERVICE_UNAVAILABLE",
        undefined,
        responseHeaders,
      );
    }
  };
}

export function createOwnerLogoutHandler({
  auth,
  bindingToken,
  bindingSecret,
  csrfToken,
  revokeSession,
  securityCookies,
  responseHeaders = {},
}: {
  auth: OwnerAuthActions;
  bindingToken: string | null | undefined;
  bindingSecret: string;
  csrfToken: string | null | undefined;
  revokeSession: (identity: FreshSupabaseIdentity) => Promise<boolean>;
  securityCookies: Pick<SecurityCookieWriter, "clear">;
  responseHeaders?: HeadersInit;
}) {
  return async function POST(request: Request): Promise<Response> {
    if (
      !requestHasExpectedOrigin(request) ||
      !validOwnerCsrfToken(csrfToken, request.headers.get("x-csrf-token"))
    ) {
      return apiErrorResponse(
        403,
        "FORBIDDEN_REQUEST",
        undefined,
        responseHeaders,
      );
    }
    if (new URL(request.url).search !== "") {
      return apiErrorResponse(
        400,
        "INVALID_REQUEST",
        undefined,
        responseHeaders,
      );
    }
    try {
      const identity = await getFreshSupabaseIdentity(auth);
      if (!identity.ok) {
        await clearSignedInState(auth, securityCookies);
        return authFailureResponse(
          identity.failure,
          "OWNER_SESSION_REQUIRED",
          responseHeaders,
        );
      }
      if (
        !verifyOwnerSessionBinding({
          token: bindingToken,
          expectedUserId: identity.userId,
          expectedSessionId: identity.sessionId,
          secret: bindingSecret,
        })
      ) {
        await clearSignedInState(auth, securityCookies);
        return apiErrorResponse(
          401,
          "OWNER_SESSION_REQUIRED",
          undefined,
          responseHeaders,
        );
      }

      const revoked = await revokeSession({
        userId: identity.userId,
        sessionId: identity.sessionId,
      });
      if (revoked !== true) throw new Error("Owner session was not revoked");
      securityCookies.clear();
      const result = await auth.signOut({ scope: "local" });
      // Database revocation is authoritative even if local cookie cleanup reports
      // an error. The response remains a successful, fail-closed logout.
      void result.error;
      return logoutSuccessResponse(responseHeaders);
    } catch {
      await clearSignedInState(auth, securityCookies);
      return apiErrorResponse(
        503,
        "SERVICE_UNAVAILABLE",
        undefined,
        responseHeaders,
      );
    }
  };
}

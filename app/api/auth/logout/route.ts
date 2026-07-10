import { createNextOwnerAuthContext } from "@/lib/server/auth/nextOwnerAuthContext.ts";
import { createOwnerLogoutHandler } from "@/lib/server/auth/ownerAuthHandlers.ts";
import {
  clearOwnerSecurityCookies,
  readOwnerSecurityCookies,
} from "@/lib/server/auth/ownerSecurityCookies.ts";
import { ownerAuthRepository } from "@/lib/server/database/ownerAuthRepository.ts";
import { apiErrorResponse } from "@/lib/server/publicApiResponse.ts";
import { observeServerRoute } from "@/lib/server/observability/runtime";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

async function logoutPostHandler(request: Request): Promise<Response> {
  try {
    const context = await createNextOwnerAuthContext(request);
    const { bindingToken, csrfToken } = readOwnerSecurityCookies(
      context.securityCookieStore,
    );
    return await createOwnerLogoutHandler({
      auth: context.auth,
      bindingToken,
      bindingSecret: process.env.OWNER_SESSION_HMAC_SECRET ?? "",
      csrfToken,
      revokeSession: ownerAuthRepository.revokeSession,
      securityCookies: {
        clear: () =>
          clearOwnerSecurityCookies(
            context.securityCookieStore,
            context.secure,
          ),
      },
      responseHeaders: context.responseHeaders,
    })(request);
  } catch {
    return apiErrorResponse(503, "SERVICE_UNAVAILABLE");
  }
}

export const POST = observeServerRoute(
  "auth.logout",
  "POST",
  logoutPostHandler,
);

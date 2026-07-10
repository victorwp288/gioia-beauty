import { apiErrorResponse } from "@/lib/server/publicApiResponse.ts";
import { ownerAuthRepository } from "@/lib/server/database/ownerAuthRepository.ts";
import { createOwnerLoginHandler } from "@/lib/server/auth/ownerAuthHandlers.ts";
import { createNextOwnerAuthContext } from "@/lib/server/auth/nextOwnerAuthContext.ts";
import {
  clearOwnerSecurityCookies,
  writeOwnerSecurityCookies,
} from "@/lib/server/auth/ownerSecurityCookies.ts";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST(request: Request): Promise<Response> {
  try {
    const context = await createNextOwnerAuthContext(request);
    return await createOwnerLoginHandler({
      auth: context.auth,
      bindingSecret: process.env.OWNER_SESSION_HMAC_SECRET ?? "",
      startSession: ownerAuthRepository.startSession,
      revokeSession: ownerAuthRepository.revokeSession,
      securityCookies: {
        set: ({ bindingToken, csrfToken }) =>
          writeOwnerSecurityCookies({
            store: context.securityCookieStore,
            bindingToken,
            csrfToken,
            secure: context.secure,
          }),
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

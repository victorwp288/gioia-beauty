import { createNextOwnerAuthContext } from "@/lib/server/auth/nextOwnerAuthContext.ts";
import { createOwnerSessionHandler } from "@/lib/server/auth/ownerAuthHandlers.ts";
import { readOwnerSecurityCookies } from "@/lib/server/auth/ownerSecurityCookies.ts";
import { ownerAuthRepository } from "@/lib/server/database/ownerAuthRepository.ts";
import { apiErrorResponse } from "@/lib/server/publicApiResponse.ts";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(request: Request): Promise<Response> {
  try {
    const context = await createNextOwnerAuthContext(request);
    const { bindingToken, csrfToken } = readOwnerSecurityCookies(
      context.securityCookieStore,
    );
    return await createOwnerSessionHandler({
      auth: context.auth,
      bindingToken,
      bindingSecret: process.env.OWNER_SESSION_HMAC_SECRET ?? "",
      csrfToken,
      authorizeSession: ownerAuthRepository.authorizeSession,
      responseHeaders: context.responseHeaders,
    })();
  } catch {
    return apiErrorResponse(503, "SERVICE_UNAVAILABLE");
  }
}

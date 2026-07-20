import "server-only";

import { createNextOwnerAuthContext } from "./auth/nextOwnerAuthContext.ts";
import {
  clearOwnerSecurityCookies,
  readOwnerSecurityCookies,
} from "./auth/ownerSecurityCookies.ts";
import { ownerAuthRepository } from "./database/ownerAuthRepository.ts";
import type { OwnerScheduleReadRuntimeContext } from "./ownerScheduleReadHandlerSupport.ts";

export async function createNextOwnerReadContext(
  request: Request,
): Promise<OwnerScheduleReadRuntimeContext> {
  const context = await createNextOwnerAuthContext(request);
  const { bindingToken } = readOwnerSecurityCookies(
    context.securityCookieStore,
  );
  return {
    auth: context.auth,
    bindingToken,
    bindingSecret: process.env.OWNER_SESSION_HMAC_SECRET ?? "",
    authorizeSession: ownerAuthRepository.authorizeSession,
    securityCookies: {
      clear: () =>
        clearOwnerSecurityCookies(context.securityCookieStore, context.secure),
    },
    responseHeaders: context.responseHeaders,
  };
}

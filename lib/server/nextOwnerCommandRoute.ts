import "server-only";

import { cookies } from "next/headers";
import type { z } from "zod";

import { createNextOwnerAuthContext } from "./auth/nextOwnerAuthContext.ts";
import { clearOwnerSecurityCookies } from "./auth/ownerSecurityCookies.ts";
import { OWNER_CSRF_COOKIE } from "./auth/requestSecurity.ts";
import { OWNER_SESSION_BINDING_COOKIE } from "./auth/sessionBinding.ts";
import type { OwnerCommandOperation } from "./database/ownerScheduleCommandContracts.ts";
import type { OwnerCommandResult } from "./database/ownerScheduleRepositorySupport.ts";
import type { OwnerTransactionIdentity } from "./database/runtime.ts";
import { createOwnerCommandHandler } from "./ownerScheduleCommandHandler.ts";
import { apiErrorResponse } from "./publicApiResponse.ts";

interface OwnerSecurityTokens {
  readonly bindingToken: string | null | undefined;
  readonly csrfToken: string | null | undefined;
}

type NextOwnerAuthContext = Awaited<
  ReturnType<typeof createNextOwnerAuthContext>
>;

export interface NextOwnerCommandRouteDependencies {
  readonly readSecurityTokens?: () => Promise<OwnerSecurityTokens>;
  readonly createAuthContext?: (
    request: Request,
  ) => Promise<NextOwnerAuthContext>;
  readonly getBindingSecret?: () => string;
  readonly createRequestId?: () => string;
  readonly now?: Date;
}

interface NextOwnerCommandDefinition<TBody extends Record<string, unknown>> {
  readonly bodySchema: z.ZodType<TBody>;
  readonly operation: OwnerCommandOperation;
  readonly version: 1;
  readonly execute: (
    identity: OwnerTransactionIdentity,
    command: TBody & { readonly idempotencyKey: string },
    requestFingerprint: Buffer,
  ) => Promise<OwnerCommandResult>;
}

async function readNextOwnerSecurityTokens(): Promise<OwnerSecurityTokens> {
  const store = await cookies();
  return {
    bindingToken: store.get(OWNER_SESSION_BINDING_COOKIE)?.value,
    csrfToken: store.get(OWNER_CSRF_COOKIE)?.value,
  };
}

export function createNextOwnerCommandRoute<
  TBody extends Record<string, unknown>,
>(
  definition: NextOwnerCommandDefinition<TBody>,
  {
    readSecurityTokens = readNextOwnerSecurityTokens,
    createAuthContext = createNextOwnerAuthContext,
    getBindingSecret = () => process.env.OWNER_SESSION_HMAC_SECRET ?? "",
    createRequestId,
    now,
  }: NextOwnerCommandRouteDependencies = {},
) {
  return async function POST(request: Request): Promise<Response> {
    let tokens: OwnerSecurityTokens;
    try {
      tokens = await readSecurityTokens();
    } catch {
      return apiErrorResponse(503, "SERVICE_UNAVAILABLE");
    }

    return createOwnerCommandHandler({
      csrfCookieToken: tokens.csrfToken,
      bodySchema: definition.bodySchema,
      operation: definition.operation,
      version: definition.version,
      createRequestId,
      now,
      loadRuntimeContext: async () => {
        const context = await createAuthContext(request);
        return {
          auth: context.auth,
          bindingToken: tokens.bindingToken,
          bindingSecret: getBindingSecret(),
          responseHeaders: context.responseHeaders,
          securityCookies: {
            clear: () =>
              clearOwnerSecurityCookies(
                context.securityCookieStore,
                context.secure,
              ),
          },
        };
      },
      execute: definition.execute,
    })(request);
  };
}

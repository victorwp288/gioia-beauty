import "server-only";

import { randomUUID } from "node:crypto";

import type { z } from "zod";

import { CommandResultResponseSchema } from "@/lib/domain/schemas/index.ts";

import {
  readAdminCommandRequest,
  type AdminCommandRequestResult,
} from "./adminCommandRequest.ts";
import {
  requireFreshBoundOwnerIdentity,
  type OwnerAuthVerifier,
} from "./auth/freshOwnerSession.ts";
import {
  clearSignedInState,
  type OwnerAuthActions,
  type SecurityCookieWriter,
} from "./auth/ownerAuthSupport.ts";
import type { OwnerCommandOperation } from "./database/ownerScheduleCommandContracts.ts";
import type { OwnerCommandResult } from "./database/ownerScheduleRepositorySupport.ts";
import type { OwnerTransactionIdentity } from "./database/runtime.ts";
import {
  classifyOwnerCommandDatabaseError,
  ownerCommandAuthResponseHeaders,
  ownerCommandDatabaseErrorResponse,
} from "./ownerCommandErrorResponse.ts";
import {
  apiErrorResponse,
  validatedJsonResponse,
} from "./publicApiResponse.ts";
import { cutoverWriteGate, type CutoverWriteGate } from "./cutoverWriteGate.ts";

export interface OwnerCommandRuntimeContext {
  readonly auth: OwnerAuthVerifier & Pick<OwnerAuthActions, "signOut">;
  readonly bindingToken: string | null | undefined;
  readonly bindingSecret: string;
  readonly securityCookies: Pick<SecurityCookieWriter, "clear">;
  readonly responseHeaders?: HeadersInit;
}

export interface OwnerCommandHandlerOptions<
  TBody extends Record<string, unknown>,
> {
  readonly csrfCookieToken: string | null | undefined;
  readonly bodySchema: z.ZodType<TBody>;
  readonly operation: OwnerCommandOperation;
  readonly version: 1;
  readonly loadRuntimeContext: () => Promise<OwnerCommandRuntimeContext>;
  readonly execute: (
    identity: OwnerTransactionIdentity,
    command: TBody & { readonly idempotencyKey: string },
    requestFingerprint: Buffer,
    canaryToken: string | null,
  ) => Promise<OwnerCommandResult>;
  readonly writeGate?: CutoverWriteGate;
  readonly createRequestId?: () => string;
  readonly now?: Date;
}

function commandApiErrorResponse(
  status: number,
  code: string,
  requestId: string,
  authRefreshHeaders: HeadersInit = {},
): Response {
  return apiErrorResponse(
    status,
    code,
    requestId,
    ownerCommandAuthResponseHeaders(authRefreshHeaders),
  );
}

async function clearRejectedOwner(
  context: OwnerCommandRuntimeContext,
): Promise<boolean> {
  try {
    await clearSignedInState(context.auth, context.securityCookies);
    return true;
  } catch {
    return false;
  }
}

export type OwnerScheduleCommandHandlerOptions<
  TBody extends Record<string, unknown>,
> = OwnerCommandHandlerOptions<TBody>;

export function createOwnerCommandHandler<
  TBody extends Record<string, unknown>,
>({
  csrfCookieToken,
  bodySchema,
  operation,
  version,
  loadRuntimeContext,
  execute,
  writeGate = cutoverWriteGate,
  createRequestId = randomUUID,
  now,
}: OwnerCommandHandlerOptions<TBody>) {
  return async function POST(request: Request): Promise<Response> {
    const requestId = createRequestId();
    let commandRequest: AdminCommandRequestResult<TBody>;
    try {
      commandRequest = await readAdminCommandRequest({
        request,
        csrfCookieToken,
        bodySchema,
        operation,
        version,
      });
    } catch {
      return commandApiErrorResponse(503, "SERVICE_UNAVAILABLE", requestId);
    }
    if (!commandRequest.ok) {
      return commandApiErrorResponse(
        commandRequest.status,
        commandRequest.code,
        requestId,
      );
    }

    const writeDecision = await writeGate.check(request, "owner");
    if (!writeDecision.ok) return writeDecision.response;

    let context: OwnerCommandRuntimeContext;
    try {
      context = await loadRuntimeContext();
    } catch {
      return commandApiErrorResponse(503, "SERVICE_UNAVAILABLE", requestId);
    }

    const identity = await requireFreshBoundOwnerIdentity({
      auth: context.auth,
      bindingToken: context.bindingToken,
      bindingSecret: context.bindingSecret,
      now,
    });
    if (!identity.ok) {
      if (identity.status === 401 && !(await clearRejectedOwner(context))) {
        return commandApiErrorResponse(
          503,
          "SERVICE_UNAVAILABLE",
          requestId,
          context.responseHeaders,
        );
      }
      const responseHeaders = ownerCommandAuthResponseHeaders(
        context.responseHeaders,
      );
      if (identity.status === 429) responseHeaders.set("Retry-After", "60");
      return apiErrorResponse(
        identity.status,
        identity.code,
        requestId,
        responseHeaders,
      );
    }

    try {
      const result = await execute(
        { userId: identity.userId, sessionId: identity.sessionId },
        commandRequest.command,
        commandRequest.requestFingerprint,
        writeDecision.canaryToken,
      );
      if (result.result.resource_id) {
        return validatedJsonResponse(
          CommandResultResponseSchema,
          {
            code: result.result.code,
            resourceId: result.result.resource_id,
            replayed: result.replayed,
          },
          result.http_status,
          ownerCommandAuthResponseHeaders(context.responseHeaders),
        );
      }
      return commandApiErrorResponse(
        result.http_status,
        result.result.code,
        requestId,
        context.responseHeaders,
      );
    } catch (error) {
      const classification = classifyOwnerCommandDatabaseError(error);
      if (
        (classification.status === 401 || classification.status === 403) &&
        !(await clearRejectedOwner(context))
      ) {
        return commandApiErrorResponse(
          503,
          "SERVICE_UNAVAILABLE",
          requestId,
          context.responseHeaders,
        );
      }
      return ownerCommandDatabaseErrorResponse(
        error,
        requestId,
        context.responseHeaders,
      );
    }
  };
}

export const createOwnerScheduleCommandHandler = createOwnerCommandHandler;

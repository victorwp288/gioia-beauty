import "server-only";

import { randomUUID } from "node:crypto";

import {
  AdminScheduleListResponseSchema,
  ScheduleCountResponseSchema,
  UuidSchema,
} from "@/lib/domain/schemas/index.ts";

import {
  requireFreshOwnerSession,
  type FreshSupabaseIdentity,
  type OwnerAuthVerifier,
  type OwnerAuthorizationDecision,
} from "./auth/freshOwnerSession.ts";
import {
  clearSignedInState,
  type OwnerAuthActions,
  type SecurityCookieWriter,
} from "./auth/ownerAuthSupport.ts";
import { exactDate } from "./exactData.ts";
import { ownerCommandAuthResponseHeaders } from "./ownerCommandErrorResponse.ts";
import {
  classifyOwnerReadExecutorAuthError,
  exactOwnerReadAuthorizationDecision,
  exactOwnerReadIdentityResult,
} from "./ownerScheduleReadAuthorization.ts";
import {
  apiErrorResponse,
  validatedJsonResponse,
} from "./publicApiResponse.ts";

const MAX_QUERY_BYTES = 1_024;

export interface OwnerScheduleReadRuntimeContext {
  readonly auth: OwnerAuthVerifier & Pick<OwnerAuthActions, "signOut">;
  readonly bindingToken: string | null | undefined;
  readonly bindingSecret: string;
  readonly authorizeSession: (
    identity: FreshSupabaseIdentity,
  ) => Promise<OwnerAuthorizationDecision>;
  readonly securityCookies: Pick<SecurityCookieWriter, "clear">;
  /** Trusted output from the Auth context; only cookie/Expires fields survive. */
  readonly responseHeaders?: HeadersInit;
}

export interface OwnerReadHandlerOptions<TPlan> {
  readonly loadRuntimeContext: () => Promise<OwnerScheduleReadRuntimeContext>;
  /** Must repeat owner/session authorization atomically with the future read. */
  readonly execute: (
    identity: FreshSupabaseIdentity,
    plan: Readonly<TPlan>,
  ) => Promise<unknown>;
  readonly createRequestId?: () => string;
  readonly readNow?: () => Date;
}

export type OwnerReadRequestFailure = Readonly<{
  ok: false;
  status: 400 | 414 | 422 | 503;
  code:
    | "INVALID_CURSOR"
    | "INVALID_QUERY"
    | "INVALID_REQUEST"
    | "QUERY_TOO_LARGE"
    | "SERVICE_UNAVAILABLE";
}>;

export type PreparedOwnerRead<TPlan> =
  | OwnerReadRequestFailure
  | Readonly<{ ok: true; plan: Readonly<TPlan>; now: Date }>;

function safeRequestId(createRequestId: () => string): string {
  try {
    const candidate = createRequestId();
    const parsed = UuidSchema.safeParse(candidate);
    if (parsed.success && parsed.data === candidate) return candidate;
  } catch {
    // Fall through to a process-owned identifier.
  }
  return randomUUID();
}

export function boundedOwnerReadSearchParams(
  request: Request,
  maximumPairs: number,
):
  | OwnerReadRequestFailure
  | Readonly<{ ok: true; searchParams: URLSearchParams }> {
  try {
    // This PII-bearing boundary is GET-only. SameSite cookies plus SOP/CORP
    // protect the response; mutation-only Origin/CSRF gates do not apply.
    if (request.method !== "GET" || request.body !== null) {
      return { ok: false, status: 400, code: "INVALID_REQUEST" };
    }
    const url = new URL(request.url);
    if (Buffer.byteLength(url.search, "utf8") > MAX_QUERY_BYTES) {
      return { ok: false, status: 414, code: "QUERY_TOO_LARGE" };
    }
    let pairs = 0;
    for (const _pair of url.searchParams) {
      pairs += 1;
      if (pairs > maximumPairs) {
        return { ok: false, status: 422, code: "INVALID_QUERY" };
      }
    }
    return { ok: true, searchParams: url.searchParams };
  } catch {
    return { ok: false, status: 422, code: "INVALID_QUERY" };
  }
}

export function ownerReadClockSnapshot(readNow: () => Date): Date | null {
  try {
    return exactDate(readNow());
  } catch {
    return null;
  }
}

function safeAuthHeaders(
  context?: OwnerScheduleReadRuntimeContext,
): Headers | null {
  try {
    return ownerCommandAuthResponseHeaders(context?.responseHeaders);
  } catch {
    return null;
  }
}

function errorResponse(
  status: number,
  code: string,
  requestId: string,
  context?: OwnerScheduleReadRuntimeContext,
): Response {
  const headers = safeAuthHeaders(context);
  if (!headers) return apiErrorResponse(503, "SERVICE_UNAVAILABLE", requestId);
  if (status === 429) headers.set("Retry-After", "60");
  return apiErrorResponse(status, code, requestId, headers);
}

async function clearRejectedOwner(
  context: OwnerScheduleReadRuntimeContext,
): Promise<boolean> {
  try {
    await clearSignedInState(context.auth, context.securityCookies);
    return true;
  } catch {
    return false;
  }
}

export function createOwnerReadHandler<TPlan>(options: {
  readonly prepare: (request: Request) => PreparedOwnerRead<TPlan>;
  readonly loadRuntimeContext: () => Promise<OwnerScheduleReadRuntimeContext>;
  readonly execute: OwnerReadHandlerOptions<TPlan>["execute"];
  readonly respond: (
    plan: Readonly<TPlan>,
    result: unknown,
    now: Date,
  ) => unknown;
  readonly responseSchema:
    typeof AdminScheduleListResponseSchema | typeof ScheduleCountResponseSchema;
  readonly createRequestId: () => string;
}) {
  return async function GET(request: Request): Promise<Response> {
    const requestId = safeRequestId(options.createRequestId);
    const prepared = options.prepare(request);
    if (!prepared.ok) {
      return errorResponse(prepared.status, prepared.code, requestId);
    }

    let context: OwnerScheduleReadRuntimeContext;
    try {
      context = await options.loadRuntimeContext();
    } catch {
      return errorResponse(503, "SERVICE_UNAVAILABLE", requestId);
    }

    let identity;
    try {
      identity = exactOwnerReadIdentityResult(
        await requireFreshOwnerSession({
          auth: context.auth,
          bindingToken: context.bindingToken,
          bindingSecret: context.bindingSecret,
          authorizeSession: async (freshIdentity) =>
            exactOwnerReadAuthorizationDecision(
              await context.authorizeSession(freshIdentity),
            ),
          now: prepared.now,
        }),
      );
    } catch {
      identity = null;
    }
    if (!identity) {
      return errorResponse(503, "SERVICE_UNAVAILABLE", requestId, context);
    }
    if (!identity.ok) {
      if (
        (identity.status === 401 || identity.status === 403) &&
        !(await clearRejectedOwner(context))
      ) {
        return errorResponse(503, "SERVICE_UNAVAILABLE", requestId, context);
      }
      return errorResponse(identity.status, identity.code, requestId, context);
    }

    let result: unknown;
    try {
      result = await options.execute(
        { userId: identity.userId, sessionId: identity.sessionId },
        prepared.plan,
      );
    } catch (error) {
      const failure = classifyOwnerReadExecutorAuthError(error);
      if (
        (failure.status === 401 || failure.status === 403) &&
        !(await clearRejectedOwner(context))
      ) {
        return errorResponse(503, "SERVICE_UNAVAILABLE", requestId, context);
      }
      return errorResponse(failure.status, failure.code, requestId, context);
    }

    try {
      const headers = safeAuthHeaders(context);
      if (!headers) throw new TypeError();
      return validatedJsonResponse(
        options.responseSchema,
        options.respond(prepared.plan, result, prepared.now),
        200,
        headers,
      );
    } catch {
      return errorResponse(503, "SERVICE_UNAVAILABLE", requestId, context);
    }
  };
}

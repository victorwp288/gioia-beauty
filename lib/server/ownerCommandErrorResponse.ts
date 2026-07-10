import "server-only";

import {
  OWNER_SCHEDULE_COMMAND_CONTRACTS,
  ownerCommandFailureKey,
  type OwnerCommandFailureStatus,
} from "./database/ownerScheduleCommandContracts.ts";
import { apiErrorResponse } from "./publicApiResponse.ts";

type OwnerCommandErrorStatus = 400 | 401 | 403 | 404 | 409 | 503;

export interface OwnerCommandErrorClassification {
  readonly status: OwnerCommandErrorStatus;
  readonly code: string;
}

const OWNER_SESSION_MESSAGES = new Set([
  "OWNER_AUTHENTICATION_REQUIRED",
  "OWNER_SESSION_EXPIRED",
  "OWNER_SESSION_REQUIRED",
  "OWNER_SESSION_REVOKED",
]);

const OWNER_AUTHORIZATION_MESSAGES = new Set([
  "OWNER_AUTHORIZATION_REQUIRED",
  "OWNER_IDENTITY_MISMATCH",
  "OWNER_SESSION_MISMATCH",
]);

const OWNER_COMMAND_ERRORS = new Set([
  ...Object.values(OWNER_SCHEDULE_COMMAND_CONTRACTS).flatMap((contract) => [
    ...contract.failures,
  ]),
  ownerCommandFailureKey(400, "COMMAND_HASH_INVALID"),
  ownerCommandFailureKey(409, "COMMAND_IN_PROGRESS"),
  ownerCommandFailureKey(409, "IDEMPOTENCY_KEY_REUSED"),
]);

const SERVICE_UNAVAILABLE = Object.freeze({
  status: 503,
  code: "SERVICE_UNAVAILABLE",
} satisfies OwnerCommandErrorClassification);

function databaseErrorFields(
  error: unknown,
): { code: string; message: string } | null {
  if (!error || typeof error !== "object") return null;
  try {
    const record = error as Record<string, unknown>;
    if (typeof record.code !== "string" || typeof record.message !== "string") {
      return null;
    }
    return { code: record.code, message: record.message };
  } catch {
    return null;
  }
}

export function classifyOwnerCommandDatabaseError(
  error: unknown,
): OwnerCommandErrorClassification {
  const fields = databaseErrorFields(error);
  if (!fields) return SERVICE_UNAVAILABLE;

  if (fields.code === "PT401" && OWNER_SESSION_MESSAGES.has(fields.message)) {
    return { status: 401, code: "OWNER_SESSION_REQUIRED" };
  }
  if (
    fields.code === "PT403" &&
    OWNER_AUTHORIZATION_MESSAGES.has(fields.message)
  ) {
    return { status: 403, code: "OWNER_AUTHORIZATION_REQUIRED" };
  }

  const statusMatch = /^PT(400|404|409)$/.exec(fields.code);
  const status = statusMatch?.[1]
    ? (Number(statusMatch[1]) as OwnerCommandFailureStatus)
    : null;
  if (
    status !== null &&
    OWNER_COMMAND_ERRORS.has(ownerCommandFailureKey(status, fields.message))
  ) {
    return { status, code: fields.message };
  }
  return SERVICE_UNAVAILABLE;
}

export function ownerCommandAuthResponseHeaders(
  authRefreshHeaders: HeadersInit = {},
): Headers {
  const supplied = new Headers(authRefreshHeaders);
  const responseHeaders = new Headers();
  if (supplied.get("expires") === "0") {
    responseHeaders.set("expires", "0");
  }
  const setCookies =
    typeof supplied.getSetCookie === "function"
      ? supplied.getSetCookie()
      : supplied.get("set-cookie")
        ? [supplied.get("set-cookie")!]
        : [];
  for (const cookie of setCookies) {
    responseHeaders.append("set-cookie", cookie);
  }
  return responseHeaders;
}

export function ownerCommandDatabaseErrorResponse(
  error: unknown,
  requestId: string,
  authRefreshHeaders: HeadersInit = {},
): Response {
  const classification = classifyOwnerCommandDatabaseError(error);
  return apiErrorResponse(
    classification.status,
    classification.code,
    requestId,
    ownerCommandAuthResponseHeaders(authRefreshHeaders),
  );
}

import "server-only";

import { randomUUID } from "node:crypto";

import { z } from "zod";

import { ApiErrorResponseSchema } from "@/lib/domain/schemas/index.ts";

const RESPONSE_HEADERS = {
  "Cache-Control": "private, no-store, max-age=0",
  "Content-Security-Policy": "default-src 'none'; frame-ancestors 'none'",
  "Content-Type": "application/json; charset=utf-8",
  "Cross-Origin-Resource-Policy": "same-origin",
  Pragma: "no-cache",
  "Referrer-Policy": "no-referrer",
  "X-Content-Type-Options": "nosniff",
  "X-Frame-Options": "DENY",
} as const;

export function securePrivateResponseHeaders(
  headers: HeadersInit = {},
): Headers {
  const merged = new Headers(RESPONSE_HEADERS);
  const supplied = new Headers(headers);
  const setCookies =
    typeof supplied.getSetCookie === "function"
      ? supplied.getSetCookie()
      : supplied.get("set-cookie")
        ? [supplied.get("set-cookie")!]
        : [];
  supplied.delete("set-cookie");
  supplied.forEach((value, name) => merged.set(name, value));
  for (const cookie of setCookies) merged.append("set-cookie", cookie);
  return merged;
}

export function validatedJsonResponse<T extends z.ZodTypeAny>(
  schema: T,
  body: unknown,
  status = 200,
  headers: HeadersInit = {},
): Response {
  const validated = schema.parse(body);
  return new Response(JSON.stringify(validated), {
    status,
    headers: securePrivateResponseHeaders(headers),
  });
}

export function apiErrorResponse(
  status: number,
  code: string,
  requestId: string = randomUUID(),
  headers: HeadersInit = {},
): Response {
  const responseHeaders = new Headers(headers);
  responseHeaders.set("X-Request-Id", requestId);
  return validatedJsonResponse(
    ApiErrorResponseSchema,
    { code, requestId },
    status,
    responseHeaders,
  );
}

const SAFE_DATABASE_ERRORS = new Map<string, number>([
  ["ACTIVE_VARIANT_NOT_FOUND", 404],
  ["COMMAND_IN_PROGRESS", 409],
  ["DATE_CLOSED_FOR_VACATION", 409],
  ["IDEMPOTENCY_KEY_REUSED", 409],
  ["PUBLIC_CONTACT_INVALID", 400],
  ["PUBLIC_DATE_TOO_EARLY", 400],
  ["PUBLIC_DATE_TOO_LATE", 400],
  ["PUBLIC_LEAD_TIME_INVALID", 400],
  ["PUBLIC_SLOT_INVALID", 400],
  ["SCHEDULE_INTERVAL_INVALID", 400],
  ["SLOT_ALIGNMENT_INVALID", 400],
  ["SLOT_OUTSIDE_BUSINESS_HOURS", 409],
  ["SLOT_UNAVAILABLE", 409],
]);

export function databaseErrorResponse(
  error: unknown,
  requestId?: string,
): Response {
  if (error && typeof error === "object") {
    const candidate = error as { code?: unknown; message?: unknown };
    if (
      typeof candidate.code === "string" &&
      /^PT(?:400|404|409)$/.test(candidate.code) &&
      typeof candidate.message === "string"
    ) {
      const status = SAFE_DATABASE_ERRORS.get(candidate.message);
      if (status) return apiErrorResponse(status, candidate.message, requestId);
    }
  }
  return apiErrorResponse(503, "SERVICE_UNAVAILABLE", requestId);
}

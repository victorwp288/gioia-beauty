import { randomUUID } from "node:crypto";

import { z } from "zod";

import {
  CommandResultResponseSchema,
  ErrorCodeSchema,
  IdempotencyKeySchema,
  PublicBookingCommandSchema,
  UuidSchema,
} from "@/lib/domain/schemas/index.ts";

import { requestFingerprint } from "./bookingSecurity.ts";
import {
  evaluatePublicAbuseGuard,
  publicAbuseRejectionResponse,
  type PublicAbuseGuard,
} from "./publicAbuseBoundary.ts";
import {
  apiErrorResponse,
  databaseErrorResponse,
  validatedJsonResponse,
} from "./publicApiResponse.ts";

const MAX_BOOKING_BODY_BYTES = 8 * 1_024;
const MAX_CONTENT_ENCODING_BYTES = 64;
const MAX_CONTENT_LENGTH_BYTES = 32;
const MAX_CONTENT_TYPE_BYTES = 64;
const MAX_IDEMPOTENCY_HEADER_BYTES = 128;
const MAX_ORIGIN_BYTES = 512;
const PublicBookingBodySchema = PublicBookingCommandSchema.omit({
  idempotencyKey: true,
});
const BookingDatabaseRowSchema = z
  .object({
    http_status: z.number().int().min(200).max(599),
    result: z
      .object({
        code: ErrorCodeSchema,
        resource_id: UuidSchema.optional(),
      })
      .strict(),
    replayed: z.boolean(),
  })
  .strict();

const SAFE_COMMAND_FAILURES = new Map<string, number>([
  ["ACTIVE_VARIANT_NOT_FOUND", 404],
  ["DATE_CLOSED_FOR_VACATION", 409],
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

interface BookingDatabase {
  createBooking(input: {
    principalScopeHash: Buffer;
    idempotencyKey: string;
    requestFingerprint: Buffer;
    date: string;
    startMinutes: number;
    serviceId: string;
    variantId: string;
    clientName: string;
    clientEmail: string;
    clientPhone: string;
    clientNote: string | null;
  }): Promise<Record<string, unknown>>;
}

export interface PublicBookingHandlerDependencies {
  database: BookingDatabase;
  abuseGuard: PublicAbuseGuard;
  createRequestId?: () => string;
}

function sameOrigin(request: Request): boolean {
  const origin = request.headers.get("origin");
  if (origin === null) return true;
  if (
    origin.trim() !== origin ||
    Buffer.byteLength(origin, "utf8") > MAX_ORIGIN_BYTES
  ) {
    return false;
  }
  try {
    const parsed = new URL(origin);
    return (
      origin === parsed.origin && parsed.origin === new URL(request.url).origin
    );
  } catch {
    return false;
  }
}

function declaredBodyLength(request: Request): number | null {
  const value = request.headers.get("content-length");
  if (value === null) return null;
  if (
    Buffer.byteLength(value, "utf8") > MAX_CONTENT_LENGTH_BYTES ||
    !/^(0|[1-9]\d*)$/.test(value)
  ) {
    return Number.NaN;
  }
  return Number(value);
}

function validateBookingFraming(request: Request) {
  const contentType = request.headers.get("content-type") ?? "";
  const contentEncoding = request.headers.get("content-encoding");
  if (
    Buffer.byteLength(contentType, "utf8") > MAX_CONTENT_TYPE_BYTES ||
    !/^application\/json(?:;\s*charset=utf-8)?$/i.test(contentType) ||
    (contentEncoding !== null &&
      (Buffer.byteLength(contentEncoding, "utf8") >
        MAX_CONTENT_ENCODING_BYTES ||
        contentEncoding.trim() !== contentEncoding ||
        contentEncoding.toLowerCase() !== "identity"))
  ) {
    return { ok: false as const, status: 415, code: "UNSUPPORTED_MEDIA_TYPE" };
  }

  const declaredLength = declaredBodyLength(request);
  if (declaredLength !== null && !Number.isSafeInteger(declaredLength)) {
    return { ok: false as const, status: 400, code: "INVALID_REQUEST" };
  }
  if (declaredLength !== null && declaredLength > MAX_BOOKING_BODY_BYTES) {
    return { ok: false as const, status: 413, code: "PAYLOAD_TOO_LARGE" };
  }

  return { ok: true as const };
}

async function readBookingBody(request: Request) {
  const reader = request.body?.getReader();
  if (!reader) {
    return { ok: false as const, status: 400, code: "INVALID_JSON" };
  }
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > MAX_BOOKING_BODY_BYTES) {
        try {
          await reader.cancel();
        } catch {
          // The size failure is authoritative even if cleanup fails.
        }
        return { ok: false as const, status: 413, code: "PAYLOAD_TOO_LARGE" };
      }
      chunks.push(value);
    }
  } catch {
    return { ok: false as const, status: 400, code: "INVALID_JSON" };
  } finally {
    reader.releaseLock();
  }

  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }

  let body: unknown;
  try {
    body = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
  } catch {
    return { ok: false as const, status: 400, code: "INVALID_JSON" };
  }
  const parsed = PublicBookingBodySchema.safeParse(body);
  if (!parsed.success) {
    return { ok: false as const, status: 422, code: "INVALID_REQUEST" };
  }
  return { ok: true as const, body: parsed.data };
}

export function createPublicBookingPostHandler({
  database,
  abuseGuard,
  createRequestId = randomUUID,
}: PublicBookingHandlerDependencies) {
  return async function POST(request: Request): Promise<Response> {
    const requestId = createRequestId();
    if (!sameOrigin(request)) {
      return apiErrorResponse(403, "FORBIDDEN_ORIGIN", requestId);
    }
    if (new URL(request.url).search !== "") {
      return apiErrorResponse(400, "INVALID_REQUEST", requestId);
    }

    const rawIdempotencyKey = request.headers.get("idempotency-key");
    if (!rawIdempotencyKey) {
      return apiErrorResponse(400, "IDEMPOTENCY_KEY_REQUIRED", requestId);
    }
    if (
      Buffer.byteLength(rawIdempotencyKey, "utf8") >
      MAX_IDEMPOTENCY_HEADER_BYTES
    ) {
      return apiErrorResponse(400, "INVALID_IDEMPOTENCY_KEY", requestId);
    }
    const idempotencyResult = IdempotencyKeySchema.safeParse(rawIdempotencyKey);
    if (
      !idempotencyResult.success ||
      idempotencyResult.data !== rawIdempotencyKey
    ) {
      return apiErrorResponse(400, "INVALID_IDEMPOTENCY_KEY", requestId);
    }

    const framingResult = validateBookingFraming(request);
    if (!framingResult.ok) {
      return apiErrorResponse(
        framingResult.status,
        framingResult.code,
        requestId,
      );
    }

    let abuseDecision;
    try {
      abuseDecision = await evaluatePublicAbuseGuard(
        abuseGuard,
        request,
        "public_booking",
      );
    } catch {
      return apiErrorResponse(503, "SERVICE_UNAVAILABLE", requestId);
    }
    if (!abuseDecision.ok) {
      return publicAbuseRejectionResponse(abuseDecision, requestId);
    }

    const bodyResult = await readBookingBody(request);
    if (!bodyResult.ok) {
      return apiErrorResponse(bodyResult.status, bodyResult.code, requestId);
    }

    const command = PublicBookingCommandSchema.parse({
      ...bodyResult.body,
      idempotencyKey: idempotencyResult.data,
    });

    try {
      const row = await database.createBooking({
        ...command,
        principalScopeHash: Buffer.from(abuseDecision.principalScopeHash),
        requestFingerprint: requestFingerprint({
          operation: "public_booking",
          version: 1,
          request: bodyResult.body,
        }),
      });
      const result = BookingDatabaseRowSchema.parse(row);

      if (
        result.http_status === 201 &&
        result.result.code === "BOOKING_CREATED" &&
        result.result.resource_id
      ) {
        return validatedJsonResponse(
          CommandResultResponseSchema,
          {
            code: result.result.code,
            resourceId: result.result.resource_id,
            replayed: result.replayed,
          },
          201,
        );
      }

      const safeStatus = SAFE_COMMAND_FAILURES.get(result.result.code);
      if (safeStatus === result.http_status && !result.result.resource_id) {
        return apiErrorResponse(safeStatus, result.result.code, requestId);
      }
      return apiErrorResponse(503, "SERVICE_UNAVAILABLE", requestId);
    } catch (error) {
      return databaseErrorResponse(error, requestId);
    }
  };
}

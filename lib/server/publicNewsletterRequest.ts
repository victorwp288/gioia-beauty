import "server-only";

import type { z } from "zod";

import {
  IdempotencyKeySchema,
  type IdempotencyKey,
} from "@/lib/domain/schemas/index.ts";
import { requestHasExpectedOrigin } from "./auth/requestSecurity.ts";
import { validNewsletterActionCsrfToken } from "./newsletterActionCsrf.ts";

const MAX_BODY_BYTES = 1_024;
const MAX_CONTENT_LENGTH_BYTES = 32;
const MAX_CONTENT_TYPE_BYTES = 64;
const MAX_CONTENT_ENCODING_BYTES = 64;
const MAX_IDEMPOTENCY_KEY_BYTES = 128;

export type PublicNewsletterRequestFailure = Readonly<{
  ok: false;
  status: 400 | 403 | 413 | 415 | 422;
  code:
    | "FORBIDDEN_REQUEST"
    | "IDEMPOTENCY_KEY_REQUIRED"
    | "INVALID_IDEMPOTENCY_KEY"
    | "INVALID_JSON"
    | "INVALID_REQUEST"
    | "PAYLOAD_TOO_LARGE"
    | "UNSUPPORTED_MEDIA_TYPE";
}>;

type FramingSuccess = Readonly<{
  ok: true;
  idempotencyKey: IdempotencyKey;
}>;

function failure(
  status: PublicNewsletterRequestFailure["status"],
  code: PublicNewsletterRequestFailure["code"],
): PublicNewsletterRequestFailure {
  return { ok: false, status, code };
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

export function validatePublicNewsletterRequest(
  request: Request,
  options: {
    readonly path: string;
    readonly csrfCookieToken?: string | null;
  },
): PublicNewsletterRequestFailure | FramingSuccess {
  let url: URL;
  try {
    url = new URL(request.url);
  } catch {
    return failure(400, "INVALID_REQUEST");
  }
  if (
    request.method !== "POST" ||
    url.pathname !== options.path ||
    url.search !== "" ||
    url.hash !== "" ||
    url.username !== "" ||
    url.password !== ""
  ) {
    return failure(400, "INVALID_REQUEST");
  }
  if (!requestHasExpectedOrigin(request)) {
    return failure(403, "FORBIDDEN_REQUEST");
  }
  if (
    options.csrfCookieToken !== undefined &&
    !validNewsletterActionCsrfToken(
      options.csrfCookieToken,
      request.headers.get("x-csrf-token"),
    )
  ) {
    return failure(403, "FORBIDDEN_REQUEST");
  }

  const rawIdempotencyKey = request.headers.get("idempotency-key");
  if (!rawIdempotencyKey) {
    return failure(400, "IDEMPOTENCY_KEY_REQUIRED");
  }
  if (
    Buffer.byteLength(rawIdempotencyKey, "utf8") > MAX_IDEMPOTENCY_KEY_BYTES
  ) {
    return failure(400, "INVALID_IDEMPOTENCY_KEY");
  }
  const idempotencyKey = IdempotencyKeySchema.safeParse(rawIdempotencyKey);
  if (!idempotencyKey.success || idempotencyKey.data !== rawIdempotencyKey) {
    return failure(400, "INVALID_IDEMPOTENCY_KEY");
  }

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
    return failure(415, "UNSUPPORTED_MEDIA_TYPE");
  }

  const length = declaredBodyLength(request);
  if (length !== null && !Number.isSafeInteger(length)) {
    return failure(400, "INVALID_REQUEST");
  }
  if (length !== null && length > MAX_BODY_BYTES) {
    return failure(413, "PAYLOAD_TOO_LARGE");
  }
  return { ok: true, idempotencyKey: idempotencyKey.data };
}

async function readBodyBytes(
  request: Request,
): Promise<PublicNewsletterRequestFailure | { ok: true; bytes: Uint8Array }> {
  const reader = request.body?.getReader();
  if (!reader) return failure(400, "INVALID_JSON");
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > MAX_BODY_BYTES) {
        try {
          await reader.cancel();
        } catch {
          // The bounded result is authoritative even when cleanup fails.
        }
        return failure(413, "PAYLOAD_TOO_LARGE");
      }
      chunks.push(value);
    }
  } catch {
    return failure(400, "INVALID_JSON");
  } finally {
    reader.releaseLock();
  }
  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return { ok: true, bytes };
}

export async function readPublicNewsletterBody<T>(
  request: Request,
  schema: z.ZodType<T>,
): Promise<
  PublicNewsletterRequestFailure | { readonly ok: true; readonly body: T }
> {
  const raw = await readBodyBytes(request);
  if (!raw.ok) return raw;
  let json: unknown;
  try {
    json = JSON.parse(
      new TextDecoder("utf-8", { fatal: true }).decode(raw.bytes),
    );
  } catch {
    return failure(400, "INVALID_JSON");
  }
  const parsed = schema.safeParse(json);
  return parsed.success
    ? { ok: true, body: parsed.data }
    : failure(422, "INVALID_REQUEST");
}

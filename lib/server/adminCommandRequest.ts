import "server-only";

import type { z } from "zod";

import {
  IdempotencyKeySchema,
  type IdempotencyKey,
} from "@/lib/domain/schemas/index.ts";

import { requestFingerprint } from "./bookingSecurity.ts";
import {
  requestHasExpectedOrigin,
  validOwnerCsrfToken,
} from "./auth/requestSecurity.ts";

const MAX_BODY_BYTES = 8 * 1_024;
const MAX_CONTENT_TYPE_BYTES = 256;
const MAX_IDEMPOTENCY_KEY_BYTES = 128;
const MAX_OPERATION_BYTES = 64;
const MAX_VERSION = 2_147_483_647;
const RESERVED_BODY_FIELDS = Object.freeze([
  "idempotencyKey",
  "csrfToken",
  "identity",
]);

type Failure =
  | {
      readonly ok: false;
      readonly status: 403;
      readonly code: "FORBIDDEN_REQUEST";
    }
  | {
      readonly ok: false;
      readonly status: 400;
      readonly code:
        | "IDEMPOTENCY_KEY_REQUIRED"
        | "INVALID_IDEMPOTENCY_KEY"
        | "INVALID_REQUEST"
        | "INVALID_JSON";
    }
  | {
      readonly ok: false;
      readonly status: 415;
      readonly code: "UNSUPPORTED_MEDIA_TYPE";
    }
  | {
      readonly ok: false;
      readonly status: 413;
      readonly code: "PAYLOAD_TOO_LARGE";
    }
  | {
      readonly ok: false;
      readonly status: 422;
      readonly code: "INVALID_REQUEST";
    };

export type AdminCommandRequestResult<TBody extends Record<string, unknown>> =
  | Failure
  | {
      readonly ok: true;
      readonly command: TBody & { readonly idempotencyKey: IdempotencyKey };
      readonly requestFingerprint: Buffer;
    };

export interface AdminCommandRequestOptions<
  TBody extends Record<string, unknown>,
> {
  readonly request: Request;
  readonly csrfCookieToken: string | null | undefined;
  readonly bodySchema: z.ZodType<TBody>;
  readonly operation: string;
  readonly version: number;
}

function declaredBodyLength(request: Request): number | null {
  const value = request.headers.get("content-length");
  if (value === null) return null;
  if (!/^(0|[1-9]\d*)$/.test(value)) return Number.NaN;
  return Number(value);
}

function validFingerprintDomain(operation: string, version: number): boolean {
  return (
    Buffer.byteLength(operation, "utf8") <= MAX_OPERATION_BYTES &&
    /^[a-z][a-z0-9_]{0,63}$/u.test(operation) &&
    Number.isSafeInteger(version) &&
    version >= 1 &&
    version <= MAX_VERSION
  );
}

function hasReservedBodyField(value: unknown): boolean {
  return (
    value !== null &&
    typeof value === "object" &&
    RESERVED_BODY_FIELDS.some((field) => Object.hasOwn(value, field))
  );
}

function readCanonicalIdempotencyKey(
  request: Request,
): Failure | { readonly ok: true; readonly value: IdempotencyKey } {
  const raw = request.headers.get("idempotency-key");
  if (!raw) {
    return { ok: false, status: 400, code: "IDEMPOTENCY_KEY_REQUIRED" };
  }
  if (Buffer.byteLength(raw, "utf8") > MAX_IDEMPOTENCY_KEY_BYTES) {
    return { ok: false, status: 400, code: "INVALID_IDEMPOTENCY_KEY" };
  }
  const parsed = IdempotencyKeySchema.safeParse(raw);
  if (!parsed.success || parsed.data !== raw) {
    return { ok: false, status: 400, code: "INVALID_IDEMPOTENCY_KEY" };
  }
  return { ok: true, value: parsed.data };
}

async function readBodyBytes(request: Request): Promise<
  | Failure
  | {
      readonly ok: true;
      readonly bytes: Uint8Array;
    }
> {
  const reader = request.body?.getReader();
  if (!reader) return { ok: false, status: 400, code: "INVALID_JSON" };
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
          // The size failure is authoritative even if stream cleanup fails.
        }
        return { ok: false, status: 413, code: "PAYLOAD_TOO_LARGE" };
      }
      chunks.push(value);
    }
  } catch {
    return { ok: false, status: 400, code: "INVALID_JSON" };
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

export async function readAdminCommandRequest<
  TBody extends Record<string, unknown>,
>({
  request,
  csrfCookieToken,
  bodySchema,
  operation,
  version,
}: AdminCommandRequestOptions<TBody>): Promise<
  AdminCommandRequestResult<TBody>
> {
  if (!validFingerprintDomain(operation, version)) {
    throw new TypeError("Admin command fingerprint domain is invalid");
  }
  if (
    !requestHasExpectedOrigin(request) ||
    !validOwnerCsrfToken(csrfCookieToken, request.headers.get("x-csrf-token"))
  ) {
    return { ok: false, status: 403, code: "FORBIDDEN_REQUEST" };
  }
  if (new URL(request.url).search !== "") {
    return { ok: false, status: 400, code: "INVALID_REQUEST" };
  }

  const idempotency = readCanonicalIdempotencyKey(request);
  if (!idempotency.ok) return idempotency;

  const contentType = request.headers.get("content-type")?.toLowerCase() ?? "";
  if (
    Buffer.byteLength(contentType, "utf8") > MAX_CONTENT_TYPE_BYTES ||
    contentType.split(";", 1)[0]?.trim() !== "application/json" ||
    ![null, "identity"].includes(request.headers.get("content-encoding"))
  ) {
    return { ok: false, status: 415, code: "UNSUPPORTED_MEDIA_TYPE" };
  }

  const declaredLength = declaredBodyLength(request);
  if (declaredLength !== null && !Number.isSafeInteger(declaredLength)) {
    return { ok: false, status: 400, code: "INVALID_REQUEST" };
  }
  if (declaredLength !== null && declaredLength > MAX_BODY_BYTES) {
    return { ok: false, status: 413, code: "PAYLOAD_TOO_LARGE" };
  }

  const raw = await readBodyBytes(request);
  if (!raw.ok) return raw;

  let json: unknown;
  try {
    json = JSON.parse(
      new TextDecoder("utf-8", { fatal: true }).decode(raw.bytes),
    );
  } catch {
    return { ok: false, status: 400, code: "INVALID_JSON" };
  }

  if (hasReservedBodyField(json)) {
    return { ok: false, status: 422, code: "INVALID_REQUEST" };
  }
  const body = bodySchema.safeParse(json);
  if (!body.success) {
    return { ok: false, status: 422, code: "INVALID_REQUEST" };
  }
  if (hasReservedBodyField(body.data)) {
    return { ok: false, status: 422, code: "INVALID_REQUEST" };
  }
  const command = { ...body.data, idempotencyKey: idempotency.value };
  const fingerprint = requestFingerprint({
    operation,
    version,
    request: body.data,
  });
  return {
    ok: true,
    command,
    requestFingerprint: Buffer.from(fingerprint),
  };
}

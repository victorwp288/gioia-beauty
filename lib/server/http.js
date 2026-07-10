const JSON_HEADERS = {
  "Cache-Control": "private, no-store, max-age=0",
  "Content-Security-Policy": "default-src 'none'; frame-ancestors 'none'",
  "Content-Type": "application/json; charset=utf-8",
  "Cross-Origin-Resource-Policy": "same-origin",
  Pragma: "no-cache",
  "Referrer-Policy": "no-referrer",
  "X-Content-Type-Options": "nosniff",
  "X-Frame-Options": "DENY",
};
const SAFE_ADDITIONAL_RESPONSE_HEADERS = new Set(["retry-after"]);

export const MAX_EMAIL_REQUEST_BYTES = 8 * 1024;
const MAX_CONTENT_TYPE_BYTES = 64;
const MAX_CONTENT_ENCODING_BYTES = 64;
const MAX_CONTENT_LENGTH_BYTES = 32;
const MAX_CLIENT_ADDRESS_HEADER_BYTES = 512;
const MAX_ORIGIN_BYTES = 512;

export function jsonResponse(body, status = 200, headers = {}) {
  const responseHeaders = new Headers(JSON_HEADERS);
  new Headers(headers).forEach((value, name) => {
    if (SAFE_ADDITIONAL_RESPONSE_HEADERS.has(name)) {
      responseHeaders.set(name, value);
    }
  });
  return new Response(JSON.stringify(body), {
    status,
    headers: responseHeaders,
  });
}

export function getClientAddress(request) {
  const forwarded = request.headers.get("x-forwarded-for");
  const realIp = request.headers.get("x-real-ip");
  if (
    (forwarded !== null &&
      Buffer.byteLength(forwarded, "utf8") > MAX_CLIENT_ADDRESS_HEADER_BYTES) ||
    (realIp !== null &&
      Buffer.byteLength(realIp, "utf8") > MAX_CLIENT_ADDRESS_HEADER_BYTES)
  ) {
    return "unknown";
  }
  const candidate = forwarded?.split(",", 1)[0] || realIp;
  return candidate?.trim().slice(0, 64) || "unknown";
}

export function isSameOriginRequest(request) {
  const origin = request.headers.get("origin");
  if (origin === null) return true;
  if (
    Buffer.byteLength(origin, "utf8") > MAX_ORIGIN_BYTES ||
    origin.trim() !== origin
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

export function hasNoQueryParameters(request) {
  try {
    return new URL(request.url).search === "";
  } catch {
    return false;
  }
}

function declaredBodyLength(request) {
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

async function readBoundedBody(request) {
  let reader;
  try {
    reader = request.body?.getReader();
  } catch {
    return { ok: false, error: "invalid_json" };
  }
  if (!reader) return { ok: false, error: "invalid_json" };

  const chunks = [];
  let total = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > MAX_EMAIL_REQUEST_BYTES) {
        try {
          await reader.cancel();
        } catch {
          // The size failure is authoritative even if cleanup fails.
        }
        return { ok: false, error: "payload_too_large" };
      }
      chunks.push(value);
    }
  } catch {
    return { ok: false, error: "invalid_json" };
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

export async function readValidatedJson(request, schema) {
  const contentType = request.headers.get("content-type") || "";
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
    return {
      ok: false,
      response: jsonResponse({ error: "unsupported_media_type" }, 415),
    };
  }

  const declaredLength = declaredBodyLength(request);
  if (declaredLength !== null && !Number.isSafeInteger(declaredLength)) {
    return {
      ok: false,
      response: jsonResponse({ error: "invalid_request" }, 400),
    };
  }
  if (declaredLength !== null && declaredLength > MAX_EMAIL_REQUEST_BYTES) {
    return {
      ok: false,
      response: jsonResponse({ error: "payload_too_large" }, 413),
    };
  }

  const rawBody = await readBoundedBody(request);
  if (!rawBody.ok) {
    return {
      ok: false,
      response: jsonResponse(
        { error: rawBody.error },
        rawBody.error === "payload_too_large" ? 413 : 400,
      ),
    };
  }

  let body;
  try {
    body = JSON.parse(
      new TextDecoder("utf-8", { fatal: true }).decode(rawBody.bytes),
    );
  } catch {
    return {
      ok: false,
      response: jsonResponse({ error: "invalid_json" }, 400),
    };
  }

  const result = schema.safeParse(body);
  if (!result.success) {
    return {
      ok: false,
      response: jsonResponse({ error: "invalid_request" }, 422),
    };
  }

  return { ok: true, data: result.data };
}

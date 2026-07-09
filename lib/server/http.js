const JSON_HEADERS = {
  "Cache-Control": "private, no-store",
  "Content-Type": "application/json",
};

export const MAX_EMAIL_REQUEST_BYTES = 8 * 1024;

export function jsonResponse(body, status = 200, headers = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...JSON_HEADERS, ...headers },
  });
}

export function getClientAddress(request) {
  const forwarded = request.headers.get("x-forwarded-for");
  const candidate =
    forwarded?.split(",")[0] || request.headers.get("x-real-ip");
  return candidate?.trim().slice(0, 64) || "unknown";
}

export function isSameOriginRequest(request) {
  const origin = request.headers.get("origin");
  if (!origin) return true;

  try {
    return new URL(origin).origin === new URL(request.url).origin;
  } catch {
    return false;
  }
}

function validationIssues(error) {
  return error.issues.map((issue) => ({
    code: issue.code,
    path: issue.path.join("."),
    message: issue.message,
  }));
}

export async function readValidatedJson(request, schema) {
  const contentType = request.headers.get("content-type") || "";
  if (!contentType.toLowerCase().startsWith("application/json")) {
    return {
      ok: false,
      response: jsonResponse({ error: "unsupported_media_type" }, 415),
    };
  }

  const declaredLength = Number(request.headers.get("content-length"));
  if (
    Number.isFinite(declaredLength) &&
    declaredLength > MAX_EMAIL_REQUEST_BYTES
  ) {
    return {
      ok: false,
      response: jsonResponse({ error: "payload_too_large" }, 413),
    };
  }

  const rawBody = await request.text();
  if (new TextEncoder().encode(rawBody).byteLength > MAX_EMAIL_REQUEST_BYTES) {
    return {
      ok: false,
      response: jsonResponse({ error: "payload_too_large" }, 413),
    };
  }

  let body;
  try {
    body = JSON.parse(rawBody);
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
      response: jsonResponse(
        { error: "invalid_request", issues: validationIssues(result.error) },
        422,
      ),
    };
  }

  return { ok: true, data: result.data };
}

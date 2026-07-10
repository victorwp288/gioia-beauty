import "server-only";

import { randomBytes, timingSafeEqual } from "node:crypto";

export const OWNER_CSRF_COOKIE = "gioia_owner_csrf";

const CSRF_BYTES = 32;
const CSRF_TOKEN_LENGTH = 43;

function canonicalToken(value: string | null | undefined): Buffer | null {
  if (!value || !/^[A-Za-z0-9_-]{43}$/.test(value)) return null;
  const decoded = Buffer.from(value, "base64url");
  if (
    decoded.length !== CSRF_BYTES ||
    decoded.toString("base64url") !== value
  ) {
    return null;
  }
  return decoded;
}

export function issueOwnerCsrfToken(): string {
  return randomBytes(CSRF_BYTES).toString("base64url");
}

export function validOwnerCsrfToken(
  cookieToken: string | null | undefined,
  headerToken: string | null | undefined,
): boolean {
  if (
    (cookieToken?.length ?? 0) !== CSRF_TOKEN_LENGTH ||
    (headerToken?.length ?? 0) !== CSRF_TOKEN_LENGTH
  ) {
    return false;
  }
  const cookie = canonicalToken(cookieToken);
  const header = canonicalToken(headerToken);
  return cookie !== null && header !== null && timingSafeEqual(cookie, header);
}

export function requestHasExpectedOrigin(request: Request): boolean {
  const origin = request.headers.get("origin");
  if (!origin || Buffer.byteLength(origin, "utf8") > 512) return false;
  try {
    const parsedOrigin = new URL(origin);
    return (
      origin === parsedOrigin.origin &&
      parsedOrigin.origin === new URL(request.url).origin
    );
  } catch {
    return false;
  }
}

import "server-only";

import { randomBytes, timingSafeEqual } from "node:crypto";

export const NEWSLETTER_ACTION_CSRF_COOKIE = "gioia_newsletter_action_csrf";
export const NEWSLETTER_ACTION_CSRF_MAX_AGE_SECONDS = 10 * 60;

const TOKEN_BYTES = 32;
const TOKEN_PATTERN = /^[A-Za-z0-9_-]{43}$/;

function decode(value: string | null | undefined): Buffer | null {
  if (!value || !TOKEN_PATTERN.test(value)) return null;
  const bytes = Buffer.from(value, "base64url");
  return bytes.length === TOKEN_BYTES && bytes.toString("base64url") === value
    ? bytes
    : null;
}

export function issueNewsletterActionCsrfToken(): string {
  return randomBytes(TOKEN_BYTES).toString("base64url");
}

export function validNewsletterActionCsrfToken(
  cookieToken: string | null | undefined,
  headerToken: string | null | undefined,
): boolean {
  const cookie = decode(cookieToken);
  const header = decode(headerToken);
  return (
    cookie !== null &&
    header !== null &&
    cookie.length === header.length &&
    timingSafeEqual(cookie, header)
  );
}

export function newsletterActionCsrfCookie(
  token: string,
  secure: boolean,
): string {
  if (!decode(token)) throw new TypeError("Invalid newsletter CSRF token");
  return [
    `${NEWSLETTER_ACTION_CSRF_COOKIE}=${token}`,
    "Path=/api/newsletter",
    `Max-Age=${NEWSLETTER_ACTION_CSRF_MAX_AGE_SECONDS}`,
    "HttpOnly",
    "SameSite=Strict",
    secure ? "Secure" : null,
  ]
    .filter(Boolean)
    .join("; ");
}

export function clearNewsletterActionCsrfCookie(secure: boolean): string {
  return [
    `${NEWSLETTER_ACTION_CSRF_COOKIE}=`,
    "Path=/api/newsletter",
    "Max-Age=0",
    "HttpOnly",
    "SameSite=Strict",
    secure ? "Secure" : null,
  ]
    .filter(Boolean)
    .join("; ");
}

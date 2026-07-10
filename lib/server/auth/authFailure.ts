import "server-only";

export type SupabaseAuthFailure = "invalid" | "rate_limited" | "unavailable";

const INVALID_AUTH_ERROR_NAMES = new Set([
  "AuthApiError",
  "AuthInvalidCredentialsError",
  "AuthInvalidJwtError",
  "AuthInvalidTokenResponseError",
  "AuthSessionMissingError",
]);

export function classifySupabaseAuthError(error: unknown): SupabaseAuthFailure {
  if (!error || typeof error !== "object") return "unavailable";
  const record = error as Record<string, unknown>;
  const name = typeof record.name === "string" ? record.name : "";
  const code = typeof record.code === "string" ? record.code : "";
  const status =
    typeof record.status === "number" && Number.isSafeInteger(record.status)
      ? record.status
      : null;

  if (status === 429 || code.includes("rate_limit")) return "rate_limited";
  if (
    name === "AuthRetryableFetchError" ||
    (status !== null && status >= 500) ||
    code === "request_timeout" ||
    code === "unexpected_failure"
  ) {
    return "unavailable";
  }
  if (
    INVALID_AUTH_ERROR_NAMES.has(name) ||
    (status !== null && status >= 400 && status < 500)
  ) {
    return "invalid";
  }
  return "unavailable";
}

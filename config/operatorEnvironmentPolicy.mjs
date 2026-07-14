export const PROTECTED_OPERATOR_ENV_KEYS = Object.freeze([
  "DATABASE_URL",
  "GCLOUD_PROJECT",
  "GIOIA_PRODUCTION_OPERATOR_DATABASE_URL",
  "GIOIA_TEST_OPERATOR_DATABASE_URL",
  "GIOIA_TEST_OWNER_PASSWORD",
  "GIOIA_TEST_PREVIEW_DATABASE_URL",
  "GOOGLE_APPLICATION_CREDENTIALS",
  "GOOGLE_CLOUD_PROJECT",
  "NEXT_PUBLIC_SUPABASE_ANON_KEY",
  "NEXT_PUBLIC_SUPABASE_SECRET_KEY",
  "NEXT_PUBLIC_SUPABASE_SERVICE_ROLE_KEY",
  "POSTGRES_PRISMA_URL",
  "POSTGRES_URL",
  "POSTGRES_URL_NON_POOLING",
  "SUPABASE_ACCESS_TOKEN",
  "SUPABASE_ANON_KEY",
  "SUPABASE_DATABASE_URL",
  "SUPABASE_DB_PASSWORD",
  "SUPABASE_PUBLISHABLE_KEY",
  "SUPABASE_SECRET_KEY",
  "SUPABASE_SERVICE_ROLE_KEY",
  "SUPABASE_URL",
  "VERCEL_TOKEN",
]);

const EXACT_KEYS = new Set(PROTECTED_OPERATOR_ENV_KEYS);
const NON_AUTHORITY_PROVIDER_ENV_KEYS = new Set([
  "SUPABASE_TELEMETRY_DISABLED",
]);
const SENSITIVE_GIOIA_KEY =
  /^GIOIA_(?:TEST|PRODUCTION)_[A-Z0-9_]*(?:DATABASE_URL|PASSWORD|SECRET|TOKEN|KEY)$/i;
const PROVIDER_KEY_FAMILIES = Object.freeze([
  /^(?:NEXT_PUBLIC_)?FIREBASE(?:_|$)/i,
  /^FIRESTORE(?:_|$)/i,
  /^POSTGRES(?:_|$)/i,
  /^PG[A-Z0-9_]*$/i,
  /^RESEND(?:_|$)/i,
  /^(?:NEXT_PUBLIC_)?SUPABASE(?:_|$)/i,
  /^VERCEL(?:_|$)/i,
]);

/**
 * Identifies credential-bearing or provider-bound variables that must not be
 * inherited by an inert operator plan compiler.
 */
export function isProtectedOperatorEnvironmentKey(key, allowedKeys = null) {
  if (typeof key !== "string" || allowedKeys?.has(key)) return false;
  const canonical = key.toUpperCase();
  if (NON_AUTHORITY_PROVIDER_ENV_KEYS.has(canonical)) return false;
  return (
    EXACT_KEYS.has(canonical) ||
    SENSITIVE_GIOIA_KEY.test(key) ||
    PROVIDER_KEY_FAMILIES.some((pattern) => pattern.test(key))
  );
}

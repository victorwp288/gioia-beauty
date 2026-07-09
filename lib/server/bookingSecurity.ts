import "server-only";

import { createHash, createHmac } from "node:crypto";

const LOCAL_TEST_SECRET =
  "gioia-local-test-only-hmac-secret-never-use-remotely-v1";
const MAX_PRINCIPAL_SOURCE_BYTES = 256;

export class BookingSecurityConfigurationError extends Error {
  constructor() {
    super("Booking security is not configured");
    this.name = "BookingSecurityConfigurationError";
  }
}

function canonicalize(value: unknown, seen: Set<object>): string {
  if (value === null) return "null";
  if (typeof value === "string" || typeof value === "boolean") {
    return JSON.stringify(value);
  }
  if (typeof value === "number") {
    if (!Number.isFinite(value)) throw new TypeError("Non-finite JSON number");
    return JSON.stringify(value);
  }
  if (typeof value !== "object") throw new TypeError("Non-JSON value");
  if (seen.has(value)) throw new TypeError("Cyclic JSON value");

  seen.add(value);
  try {
    if (Array.isArray(value)) {
      for (let index = 0; index < value.length; index += 1) {
        if (!(index in value)) throw new TypeError("Sparse JSON array");
      }
      return `[${value.map((item) => canonicalize(item, seen)).join(",")}]`;
    }

    const prototype = Object.getPrototypeOf(value);
    if (prototype !== Object.prototype && prototype !== null) {
      throw new TypeError("Non-plain JSON object");
    }
    const record = value as Record<string, unknown>;
    const entries = Object.keys(record)
      .sort()
      .map(
        (key) => `${JSON.stringify(key)}:${canonicalize(record[key], seen)}`,
      );
    return `{${entries.join(",")}}`;
  } finally {
    seen.delete(value);
  }
}

export function canonicalJson(value: unknown): string {
  return canonicalize(value, new Set());
}

export function requestFingerprint(value: unknown): Buffer {
  return createHash("sha256").update(canonicalJson(value), "utf8").digest();
}

export function resolveBookingHmacSecret(
  env: Readonly<Record<string, string | undefined>> = process.env,
): Buffer {
  const configured = env.BOOKING_HMAC_SECRET;
  if (configured !== undefined) {
    if (
      configured.trim() !== configured ||
      configured.includes("\0") ||
      Buffer.byteLength(configured, "utf8") < 32
    ) {
      throw new BookingSecurityConfigurationError();
    }
    return Buffer.from(configured, "utf8");
  }

  if (env.APP_ENV === "local" || env.APP_ENV === "test") {
    return Buffer.from(LOCAL_TEST_SECRET, "utf8");
  }
  throw new BookingSecurityConfigurationError();
}

export function hmacPrincipalScope(principal: string, secret: Buffer): Buffer {
  if (
    Buffer.byteLength(principal, "utf8") > MAX_PRINCIPAL_SOURCE_BYTES ||
    /[\0\r\n]/.test(principal)
  ) {
    throw new TypeError("Invalid principal scope source");
  }
  return createHmac("sha256", secret)
    .update("gioia:public-principal:v1\0", "utf8")
    .update(principal, "utf8")
    .digest();
}

function requestPrincipalSource(request: Request, appEnv: string): string {
  const headers = ["x-vercel-forwarded-for"];
  if (appEnv === "local" || appEnv === "test") {
    headers.push("x-forwarded-for", "x-real-ip");
  }

  for (const header of headers) {
    const candidate = request.headers.get(header)?.split(",", 1)[0]?.trim();
    if (candidate && /^[0-9a-fA-F:.]{2,64}$/.test(candidate)) {
      return `network:${candidate}`;
    }
  }
  return "network:unavailable";
}

export function requestPrincipalScopeHash(
  request: Request,
  env: Readonly<Record<string, string | undefined>> = process.env,
): Buffer {
  return hmacPrincipalScope(
    requestPrincipalSource(request, env.APP_ENV ?? "unknown"),
    resolveBookingHmacSecret(env),
  );
}

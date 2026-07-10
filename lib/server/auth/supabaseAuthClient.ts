import "server-only";

import { createServerClient, type CookieMethodsServer } from "@supabase/ssr";
import type { SupabaseClient } from "@supabase/supabase-js";

const MAX_API_URL_BYTES = 2_048;
const MAX_PUBLISHABLE_KEY_BYTES = 4_096;
export const OWNER_AUTH_REQUEST_TIMEOUT_MS = 10_000;

export type OwnerAuthClient = Readonly<Pick<SupabaseClient, "auth">>;

type ServerClientOptions = Parameters<typeof createServerClient>[2];
type ServerClientFactory = (
  url: string,
  publishableKey: string,
  options: ServerClientOptions,
) => SupabaseClient;

export interface OwnerAuthClientOptions {
  cookies: CookieMethodsServer;
  env?: Readonly<Record<string, string | undefined>>;
  clientFactory?: ServerClientFactory;
}

export class OwnerAuthConfigurationError extends Error {
  constructor() {
    super("Owner authentication is not configured");
    this.name = "OwnerAuthConfigurationError";
  }
}

function configuredApiUrl(value: string | undefined): URL {
  if (
    !value ||
    value.trim() !== value ||
    Buffer.byteLength(value, "utf8") > MAX_API_URL_BYTES
  ) {
    throw new OwnerAuthConfigurationError();
  }

  try {
    const url = new URL(value);
    const loopback = new Set(["127.0.0.1", "localhost", "::1"]);
    if (
      !["http:", "https:"].includes(url.protocol) ||
      (url.protocol === "http:" && !loopback.has(url.hostname)) ||
      url.username ||
      url.password ||
      url.pathname !== "/" ||
      url.search ||
      url.hash
    ) {
      throw new OwnerAuthConfigurationError();
    }
    return url;
  } catch (error) {
    if (error instanceof OwnerAuthConfigurationError) throw error;
    throw new OwnerAuthConfigurationError();
  }
}

function configuredPublishableKey(value: string | undefined): string {
  if (
    !value ||
    value.trim() !== value ||
    value.includes("\0") ||
    Buffer.byteLength(value, "utf8") < 16 ||
    Buffer.byteLength(value, "utf8") > MAX_PUBLISHABLE_KEY_BYTES
  ) {
    throw new OwnerAuthConfigurationError();
  }
  return value;
}

const defaultClientFactory: ServerClientFactory = createServerClient;

export const boundedOwnerAuthFetch: typeof fetch = (input, init) => {
  const requestSignal =
    init?.signal ?? (input instanceof Request ? input.signal : undefined);
  const timeoutSignal = AbortSignal.timeout(OWNER_AUTH_REQUEST_TIMEOUT_MS);
  const signal = requestSignal
    ? AbortSignal.any([requestSignal, timeoutSignal])
    : timeoutSignal;
  return fetch(input, { ...init, signal });
};

export function createOwnerAuthClient({
  cookies,
  env = process.env,
  clientFactory = defaultClientFactory,
}: OwnerAuthClientOptions): OwnerAuthClient {
  const apiUrl = configuredApiUrl(env.NEXT_PUBLIC_SUPABASE_URL);
  const publishableKey = configuredPublishableKey(
    env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY,
  );
  const client = clientFactory(apiUrl.href, publishableKey, {
    global: { fetch: boundedOwnerAuthFetch },
    cookies,
    cookieEncoding: "base64url",
    cookieOptions: {
      httpOnly: true,
      path: "/",
      sameSite: "lax",
      secure: apiUrl.protocol === "https:",
    },
  });

  return Object.freeze({ auth: client.auth });
}

import "server-only";

import { cookies } from "next/headers";
import type { CookieMethodsServer, CookieOptions } from "@supabase/ssr";

import {
  createOwnerAuthClient,
  type OwnerAuthClient,
} from "./supabaseAuthClient.ts";
import type { OwnerSecurityCookieStore } from "./ownerSecurityCookies.ts";

function normalizedSameSite(value: CookieOptions["sameSite"]) {
  if (value === true) return "strict" as const;
  if (value === false) return undefined;
  return value;
}

function nextCookieOptions(options: CookieOptions) {
  return {
    domain: options.domain,
    expires: options.expires,
    httpOnly: options.httpOnly,
    maxAge: options.maxAge,
    partitioned: options.partitioned,
    path: options.path,
    priority: options.priority,
    sameSite: normalizedSameSite(options.sameSite),
    secure: options.secure,
  };
}

export async function createNextOwnerAuthContext(request: Request): Promise<{
  auth: OwnerAuthClient["auth"];
  responseHeaders: Headers;
  securityCookieStore: OwnerSecurityCookieStore;
  secure: boolean;
}> {
  const cookieStore = await cookies();
  const responseHeaders = new Headers();
  const authCookies: CookieMethodsServer = {
    getAll: () =>
      cookieStore.getAll().map(({ name, value }) => ({ name, value })),
    setAll: (cookiesToSet, headers) => {
      for (const { name, value, options } of cookiesToSet) {
        cookieStore.set(name, value, nextCookieOptions(options));
      }
      for (const [name, value] of Object.entries(headers)) {
        responseHeaders.set(name, value);
      }
    },
  };
  const securityCookieStore: OwnerSecurityCookieStore = {
    get: (name) => cookieStore.get(name),
    set: (name, value, options) => cookieStore.set(name, value, options),
  };
  const { auth } = createOwnerAuthClient({ cookies: authCookies });

  return {
    auth,
    responseHeaders,
    securityCookieStore,
    secure: new URL(request.url).protocol === "https:",
  };
}

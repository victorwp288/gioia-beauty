import "server-only";

import {
  OWNER_SESSION_BINDING_COOKIE,
  OWNER_SESSION_MAX_AGE_SECONDS,
} from "./sessionBinding.ts";
import { OWNER_CSRF_COOKIE } from "./requestSecurity.ts";

export interface OwnerSecurityCookieOptions {
  expires?: Date;
  httpOnly: boolean;
  maxAge: number;
  path: "/";
  sameSite: "strict";
  secure: boolean;
}

export interface OwnerSecurityCookieStore {
  get(name: string): { value: string } | undefined;
  set(name: string, value: string, options: OwnerSecurityCookieOptions): void;
}

function cookieOptions(
  secure: boolean,
  httpOnly: boolean,
): OwnerSecurityCookieOptions {
  return {
    httpOnly,
    maxAge: OWNER_SESSION_MAX_AGE_SECONDS,
    path: "/",
    sameSite: "strict",
    secure,
  };
}

export function readOwnerSecurityCookies(store: OwnerSecurityCookieStore) {
  return {
    bindingToken: store.get(OWNER_SESSION_BINDING_COOKIE)?.value,
    csrfToken: store.get(OWNER_CSRF_COOKIE)?.value,
  };
}

export function writeOwnerSecurityCookies({
  store,
  bindingToken,
  csrfToken,
  secure,
}: {
  store: OwnerSecurityCookieStore;
  bindingToken: string;
  csrfToken: string;
  secure: boolean;
}): void {
  store.set(
    OWNER_SESSION_BINDING_COOKIE,
    bindingToken,
    cookieOptions(secure, true),
  );
  store.set(OWNER_CSRF_COOKIE, csrfToken, cookieOptions(secure, false));
}

export function clearOwnerSecurityCookies(
  store: OwnerSecurityCookieStore,
  secure: boolean,
): void {
  const expired = new Date(0);
  for (const [name, httpOnly] of [
    [OWNER_SESSION_BINDING_COOKIE, true],
    [OWNER_CSRF_COOKIE, false],
  ] as const) {
    store.set(name, "", {
      ...cookieOptions(secure, httpOnly),
      expires: expired,
      maxAge: 0,
    });
  }
}

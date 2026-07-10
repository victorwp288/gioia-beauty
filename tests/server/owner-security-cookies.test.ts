import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import {
  clearOwnerSecurityCookies,
  readOwnerSecurityCookies,
  writeOwnerSecurityCookies,
  type OwnerSecurityCookieStore,
} from "@/lib/server/auth/ownerSecurityCookies.ts";
import { OWNER_CSRF_COOKIE } from "@/lib/server/auth/requestSecurity.ts";
import {
  OWNER_SESSION_BINDING_COOKIE,
  OWNER_SESSION_MAX_AGE_SECONDS,
} from "@/lib/server/auth/sessionBinding.ts";

function store(values: Record<string, string> = {}) {
  return {
    get: vi.fn((name: string) =>
      values[name] === undefined ? undefined : { value: values[name] },
    ),
    set: vi.fn<OwnerSecurityCookieStore["set"]>(),
  };
}

describe("owner security cookies", () => {
  it("writes a strict HttpOnly binding and readable CSRF token", () => {
    const cookieStore = store();
    writeOwnerSecurityCookies({
      store: cookieStore,
      bindingToken: "binding",
      csrfToken: "csrf",
      secure: true,
    });

    expect(cookieStore.set).toHaveBeenNthCalledWith(
      1,
      OWNER_SESSION_BINDING_COOKIE,
      "binding",
      expect.objectContaining({
        httpOnly: true,
        maxAge: OWNER_SESSION_MAX_AGE_SECONDS,
        path: "/",
        sameSite: "strict",
        secure: true,
      }),
    );
    expect(cookieStore.set).toHaveBeenNthCalledWith(
      2,
      OWNER_CSRF_COOKIE,
      "csrf",
      expect.objectContaining({ httpOnly: false, secure: true }),
    );
  });

  it("reads and expires both cookies on the same host-only path", () => {
    const cookieStore = store({
      [OWNER_SESSION_BINDING_COOKIE]: "binding",
      [OWNER_CSRF_COOKIE]: "csrf",
    });
    expect(readOwnerSecurityCookies(cookieStore)).toEqual({
      bindingToken: "binding",
      csrfToken: "csrf",
    });

    clearOwnerSecurityCookies(cookieStore, false);
    expect(cookieStore.set).toHaveBeenCalledTimes(2);
    for (const call of cookieStore.set.mock.calls) {
      expect(call[1]).toBe("");
      expect(call[2]).toMatchObject({
        expires: new Date(0),
        maxAge: 0,
        path: "/",
        sameSite: "strict",
        secure: false,
      });
    }
  });
});

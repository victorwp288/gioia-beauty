import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { createOwnerLoginHandler } from "@/lib/server/auth/ownerAuthHandlers.ts";
import { verifyOwnerSessionBinding } from "@/lib/server/auth/sessionBinding.ts";
import type { PublicAbuseGuard } from "@/lib/server/publicAbuseBoundary.ts";
import {
  createHandlerFixture,
  ownerBindingSecret,
  ownerLoginRequest,
  ownerResponseBody,
  ownerSessionId,
  ownerUserId,
} from "./owner-auth-handler-fixture.ts";

const ALLOWED_ABUSE_DECISION = {
  ok: true as const,
  principalScopeHash: Buffer.alloc(32, 0x42),
  humanVerified: false,
};

function allowingAbuseGuard() {
  return {
    check: vi.fn(async () => ALLOWED_ABUSE_DECISION),
  } satisfies PublicAbuseGuard;
}

function handler(
  fixture: ReturnType<typeof createHandlerFixture>,
  abuseGuard: PublicAbuseGuard = allowingAbuseGuard(),
) {
  return createOwnerLoginHandler({
    auth: fixture.auth,
    abuseGuard,
    bindingSecret: ownerBindingSecret,
    startSession: fixture.sessionOperation,
    revokeSession: fixture.revokeOperation,
    securityCookies: fixture.securityCookies,
  });
}

describe("owner login handler", () => {
  it("creates one bound session only after fresh Auth and DB authorization", async () => {
    const fixture = createHandlerFixture();
    const abuseGuard = allowingAbuseGuard();
    const response = await createOwnerLoginHandler({
      auth: fixture.auth,
      abuseGuard,
      bindingSecret: ownerBindingSecret,
      startSession: fixture.sessionOperation,
      revokeSession: fixture.revokeOperation,
      securityCookies: fixture.securityCookies,
      responseHeaders: { "x-auth-refresh": "applied" },
    })(ownerLoginRequest());

    expect(response.status).toBe(200);
    const body = await ownerResponseBody(response);
    expect(body).toMatchObject({ code: "OWNER_SESSION_CREATED" });
    expect(body.csrfToken).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(response.headers.get("cache-control")).toContain("no-store");
    expect(response.headers.get("x-auth-refresh")).toBe("applied");
    expect(abuseGuard.check).toHaveBeenNthCalledWith(
      1,
      { headers: expect.any(Headers) },
      "owner_login",
    );
    expect(abuseGuard.check).toHaveBeenNthCalledWith(
      2,
      { headers: expect.any(Headers) },
      "owner_login",
      {
        kind: "account",
        value: "owner@example.test",
        humanVerified: false,
      },
    );
    expect(abuseGuard.check.mock.invocationCallOrder[1]).toBeLessThan(
      fixture.auth.signInWithPassword.mock.invocationCallOrder[0]!,
    );
    expect(fixture.auth.signInWithPassword).toHaveBeenCalledWith({
      email: "owner@example.test",
      password: "synthetic-password",
    });
    expect(fixture.auth.getUser).toHaveBeenCalledWith(fixture.accessToken);
    expect(fixture.sessionOperation).toHaveBeenCalledWith({
      userId: ownerUserId,
      sessionId: ownerSessionId,
    });
    const written = fixture.securityCookies.set.mock.calls[0]?.[0];
    expect(written.csrfToken).toBe(body.csrfToken);
    expect(
      verifyOwnerSessionBinding({
        token: written.bindingToken,
        expectedUserId: ownerUserId,
        expectedSessionId: ownerSessionId,
        secret: ownerBindingSecret,
      }),
    ).not.toBeNull();
  });

  it("returns a non-enumerating 401 and clears state for bad credentials", async () => {
    const fixture = createHandlerFixture({
      signInError: {
        name: "AuthApiError",
        status: 400,
        code: "invalid_credentials",
      },
    });
    const response = await handler(fixture)(ownerLoginRequest());
    expect(response.status).toBe(401);
    expect(await ownerResponseBody(response)).toMatchObject({
      code: "INVALID_CREDENTIALS",
    });
    expect(fixture.sessionOperation).not.toHaveBeenCalled();
    expect(fixture.securityCookies.clear).toHaveBeenCalledTimes(1);
    expect(fixture.auth.signOut).toHaveBeenCalledWith({ scope: "local" });
  });

  it.each([
    [
      "retryable outage",
      { name: "AuthRetryableFetchError", status: 503 },
      503,
      "SERVICE_UNAVAILABLE",
    ],
    [
      "rate limit",
      { name: "AuthApiError", status: 429, code: "over_request_rate_limit" },
      429,
      "RATE_LIMITED",
    ],
  ])(
    "does not misclassify a returned %s as invalid credentials",
    async (_label, signInError, status, code) => {
      const fixture = createHandlerFixture({ signInError });
      const response = await handler(fixture)(ownerLoginRequest());
      expect(response.status).toBe(status);
      expect(await ownerResponseBody(response)).toMatchObject({ code });
      if (status === 429)
        expect(response.headers.get("retry-after")).toBe("60");
      expect(fixture.sessionOperation).not.toHaveBeenCalled();
    },
  );

  it("returns 403 and leaves no bound session for an authenticated non-owner", async () => {
    const fixture = createHandlerFixture({ owner: false });
    const response = await handler(fixture)(ownerLoginRequest());
    expect(response.status).toBe(403);
    expect(await ownerResponseBody(response)).toMatchObject({
      code: "OWNER_AUTHORIZATION_REQUIRED",
    });
    expect(fixture.securityCookies.set).not.toHaveBeenCalled();
    expect(fixture.securityCookies.clear).toHaveBeenCalledTimes(1);
  });

  it("revokes a started ledger session if cookie issuance fails", async () => {
    const fixture = createHandlerFixture();
    fixture.securityCookies.set.mockImplementationOnce(() => {
      throw new Error("synthetic cookie failure");
    });
    const response = await handler(fixture)(ownerLoginRequest());
    expect(response.status).toBe(503);
    expect(fixture.revokeOperation).toHaveBeenCalledWith({
      userId: ownerUserId,
      sessionId: ownerSessionId,
    });
    expect(fixture.securityCookies.clear).toHaveBeenCalledTimes(1);
    expect(fixture.auth.signOut).toHaveBeenCalledWith({ scope: "local" });
  });

  it("rejects a missing or foreign Origin before Auth work", async () => {
    for (const origin of [undefined, "https://attacker.example.test"]) {
      const fixture = createHandlerFixture();
      const request = ownerLoginRequest(
        "https://app.example.test",
        "?unexpected=1",
      );
      if (origin) request.headers.set("origin", origin);
      else request.headers.delete("origin");
      const response = await handler(fixture)(request);
      expect(response.status).toBe(403);
      expect(fixture.auth.signInWithPassword).not.toHaveBeenCalled();
    }
  });

  it("rejects a query before body, Auth, database, or cookie mutation", async () => {
    const fixture = createHandlerFixture();
    const abuseGuard = allowingAbuseGuard();
    const request = ownerLoginRequest(
      "https://app.example.test",
      "?unexpected=1",
    );
    const getReader = vi.spyOn(request.body!, "getReader");

    const response = await handler(fixture, abuseGuard)(request);

    expect(response.status).toBe(400);
    expect(await ownerResponseBody(response)).toMatchObject({
      code: "INVALID_REQUEST",
    });
    expect(getReader).not.toHaveBeenCalled();
    expect(abuseGuard.check).not.toHaveBeenCalled();
    expect(fixture.auth.signInWithPassword).not.toHaveBeenCalled();
    expect(fixture.auth.getSession).not.toHaveBeenCalled();
    expect(fixture.auth.getUser).not.toHaveBeenCalled();
    expect(fixture.auth.signOut).not.toHaveBeenCalled();
    expect(fixture.sessionOperation).not.toHaveBeenCalled();
    expect(fixture.revokeOperation).not.toHaveBeenCalled();
    expect(fixture.securityCookies.set).not.toHaveBeenCalled();
    expect(fixture.securityCookies.clear).not.toHaveBeenCalled();
  });

  it.each([
    [
      "network",
      [
        {
          ok: false,
          status: 429,
          code: "RATE_LIMITED",
          retryAfterSeconds: 77,
        },
      ],
      429,
      "RATE_LIMITED",
      "77",
      1,
    ],
    [
      "account post-threshold",
      [
        ALLOWED_ABUSE_DECISION,
        {
          ok: false,
          status: 429,
          code: "RATE_LIMITED",
          retryAfterSeconds: 123,
        },
      ],
      429,
      "RATE_LIMITED",
      "123",
      2,
    ],
    [
      "unavailable boundary",
      [
        ALLOWED_ABUSE_DECISION,
        { ok: false, status: 503, code: "SERVICE_UNAVAILABLE" },
      ],
      503,
      "SERVICE_UNAVAILABLE",
      null,
      2,
    ],
  ] as const)(
    "returns the fixed $0 rejection before any Auth or session work",
    async (_label, decisions, status, code, retryAfter, expectedChecks) => {
      const fixture = createHandlerFixture();
      const check = vi.fn();
      for (const decision of decisions) check.mockResolvedValueOnce(decision);
      const response = await handler(fixture, { check })(ownerLoginRequest());

      expect(response.status).toBe(status);
      expect(await ownerResponseBody(response)).toMatchObject({ code });
      expect(response.headers.get("retry-after")).toBe(retryAfter);
      expect(check).toHaveBeenCalledTimes(expectedChecks);
      expect(fixture.auth.signInWithPassword).not.toHaveBeenCalled();
      expect(fixture.auth.getSession).not.toHaveBeenCalled();
      expect(fixture.auth.getUser).not.toHaveBeenCalled();
      expect(fixture.auth.signOut).not.toHaveBeenCalled();
      expect(fixture.sessionOperation).not.toHaveBeenCalled();
      expect(fixture.revokeOperation).not.toHaveBeenCalled();
      expect(fixture.securityCookies.set).not.toHaveBeenCalled();
      expect(fixture.securityCookies.clear).not.toHaveBeenCalled();
    },
  );

  it("redacts malformed or thrown abuse decisions without exposing the account", async () => {
    for (const check of [
      vi.fn(async () => ({
        ok: false,
        status: 429,
        code: "owner@example.test",
        retryAfterSeconds: 10,
      })),
      vi.fn(async () => {
        throw new Error("owner@example.test provider detail");
      }),
    ]) {
      const fixture = createHandlerFixture();
      const response = await handler(fixture, { check })(ownerLoginRequest());
      const serialized = JSON.stringify(await ownerResponseBody(response));

      expect(response.status).toBe(503);
      expect(serialized).toContain("SERVICE_UNAVAILABLE");
      expect(serialized).not.toContain("owner@example.test");
      expect(fixture.auth.signInWithPassword).not.toHaveBeenCalled();
    }
  });
});

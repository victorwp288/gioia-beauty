import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { createOwnerLoginHandler } from "@/lib/server/auth/ownerAuthHandlers.ts";
import { verifyOwnerSessionBinding } from "@/lib/server/auth/sessionBinding.ts";
import {
  createHandlerFixture,
  ownerBindingSecret,
  ownerLoginRequest,
  ownerResponseBody,
  ownerSessionId,
  ownerUserId,
} from "./owner-auth-handler-fixture.ts";

function handler(fixture: ReturnType<typeof createHandlerFixture>) {
  return createOwnerLoginHandler({
    auth: fixture.auth,
    bindingSecret: ownerBindingSecret,
    startSession: fixture.sessionOperation,
    revokeSession: fixture.revokeOperation,
    securityCookies: fixture.securityCookies,
  });
}

describe("owner login handler", () => {
  it("creates one bound session only after fresh Auth and DB authorization", async () => {
    const fixture = createHandlerFixture();
    const response = await createOwnerLoginHandler({
      auth: fixture.auth,
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
    const request = ownerLoginRequest(
      "https://app.example.test",
      "?unexpected=1",
    );
    const getReader = vi.spyOn(request.body!, "getReader");

    const response = await handler(fixture)(request);

    expect(response.status).toBe(400);
    expect(await ownerResponseBody(response)).toMatchObject({
      code: "INVALID_REQUEST",
    });
    expect(getReader).not.toHaveBeenCalled();
    expect(fixture.auth.signInWithPassword).not.toHaveBeenCalled();
    expect(fixture.auth.getSession).not.toHaveBeenCalled();
    expect(fixture.auth.getUser).not.toHaveBeenCalled();
    expect(fixture.auth.signOut).not.toHaveBeenCalled();
    expect(fixture.sessionOperation).not.toHaveBeenCalled();
    expect(fixture.revokeOperation).not.toHaveBeenCalled();
    expect(fixture.securityCookies.set).not.toHaveBeenCalled();
    expect(fixture.securityCookies.clear).not.toHaveBeenCalled();
  });
});

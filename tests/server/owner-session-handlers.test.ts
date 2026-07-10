import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import {
  createOwnerLogoutHandler,
  createOwnerSessionHandler,
} from "@/lib/server/auth/ownerAuthHandlers.ts";
import { issueOwnerCsrfToken } from "@/lib/server/auth/requestSecurity.ts";
import { issueOwnerSessionBinding } from "@/lib/server/auth/sessionBinding.ts";
import {
  createHandlerFixture,
  ownerBindingSecret,
  ownerLogoutRequest,
  ownerResponseBody,
  ownerSessionId,
  ownerUserId,
} from "./owner-auth-handler-fixture.ts";

function binding(sessionId = ownerSessionId) {
  return issueOwnerSessionBinding({
    userId: ownerUserId,
    sessionId,
    secret: ownerBindingSecret,
  });
}

function logoutHandler(
  fixture: ReturnType<typeof createHandlerFixture>,
  csrfToken: string,
  bindingToken = binding(),
) {
  return createOwnerLogoutHandler({
    auth: fixture.auth,
    bindingToken,
    bindingSecret: ownerBindingSecret,
    csrfToken,
    revokeSession: fixture.revokeOperation,
    securityCookies: fixture.securityCookies,
  });
}

describe("owner session and logout handlers", () => {
  it("returns a current session only with binding, CSRF, and live authorization", async () => {
    const fixture = createHandlerFixture();
    const csrfToken = issueOwnerCsrfToken();
    const response = await createOwnerSessionHandler({
      auth: fixture.auth,
      bindingToken: binding(),
      bindingSecret: ownerBindingSecret,
      csrfToken,
      authorizeSession: fixture.sessionOperation,
      securityCookies: fixture.securityCookies,
    })();
    expect(response.status).toBe(200);
    expect(await ownerResponseBody(response)).toEqual({
      code: "OWNER_SESSION_ACTIVE",
      csrfToken,
    });
    expect(fixture.securityCookies.clear).not.toHaveBeenCalled();
  });

  it("returns 503 rather than 401 for a retryable verification outage", async () => {
    const fixture = createHandlerFixture({
      userError: { name: "AuthRetryableFetchError", status: 503 },
    });
    const csrfToken = issueOwnerCsrfToken();
    const response = await createOwnerSessionHandler({
      auth: fixture.auth,
      bindingToken: binding(),
      bindingSecret: ownerBindingSecret,
      csrfToken,
      authorizeSession: fixture.sessionOperation,
      securityCookies: fixture.securityCookies,
    })();
    expect(response.status).toBe(503);
    expect(await ownerResponseBody(response)).toMatchObject({
      code: "SERVICE_UNAVAILABLE",
    });
    expect(fixture.securityCookies.clear).not.toHaveBeenCalled();
  });

  it("clears signed-in state after binding or owner authorization rejection", async () => {
    const bindingFixture = createHandlerFixture();
    const csrfToken = issueOwnerCsrfToken();
    const bindingResponse = await createOwnerSessionHandler({
      auth: bindingFixture.auth,
      bindingToken: binding("30000000-0000-4000-8000-000000000001"),
      bindingSecret: ownerBindingSecret,
      csrfToken,
      authorizeSession: bindingFixture.sessionOperation,
      securityCookies: bindingFixture.securityCookies,
    })();
    expect(bindingResponse.status).toBe(401);
    expect(bindingFixture.securityCookies.clear).toHaveBeenCalledOnce();
    expect(bindingFixture.auth.signOut).toHaveBeenCalledWith({
      scope: "local",
    });

    const ownerFixture = createHandlerFixture({ owner: false });
    const ownerResponse = await createOwnerSessionHandler({
      auth: ownerFixture.auth,
      bindingToken: binding(),
      bindingSecret: ownerBindingSecret,
      csrfToken,
      authorizeSession: ownerFixture.sessionOperation,
      securityCookies: ownerFixture.securityCookies,
    })();
    expect(ownerResponse.status).toBe(403);
    expect(ownerFixture.securityCookies.clear).toHaveBeenCalledOnce();
    expect(ownerFixture.auth.signOut).toHaveBeenCalledWith({ scope: "local" });
  });

  it("logs out only for an exact same-origin CSRF token", async () => {
    const fixture = createHandlerFixture();
    const csrfToken = issueOwnerCsrfToken();
    const handler = logoutHandler(fixture, csrfToken);
    const accepted = await handler(ownerLogoutRequest(csrfToken));
    expect(accepted.status).toBe(200);
    expect(fixture.revokeOperation).toHaveBeenCalledWith({
      userId: ownerUserId,
      sessionId: ownerSessionId,
    });
    expect(
      fixture.revokeOperation.mock.invocationCallOrder[0] ??
        Number.POSITIVE_INFINITY,
    ).toBeLessThan(
      fixture.auth.signOut.mock.invocationCallOrder[0] ??
        Number.NEGATIVE_INFINITY,
    );
    expect(fixture.securityCookies.clear).toHaveBeenCalledTimes(1);

    const rejected = await handler(
      ownerLogoutRequest(csrfToken, "https://attacker.example.test"),
    );
    expect(rejected.status).toBe(403);
    expect(fixture.securityCookies.clear).toHaveBeenCalledTimes(1);
  });

  it("fails closed before revocation for a mismatched binding", async () => {
    const fixture = createHandlerFixture();
    const csrfToken = issueOwnerCsrfToken();
    const response = await logoutHandler(
      fixture,
      csrfToken,
      binding("30000000-0000-4000-8000-000000000001"),
    )(ownerLogoutRequest(csrfToken));
    expect(response.status).toBe(401);
    expect(fixture.revokeOperation).not.toHaveBeenCalled();
    expect(fixture.securityCookies.clear).toHaveBeenCalledTimes(1);
    expect(fixture.auth.signOut).toHaveBeenCalledWith({ scope: "local" });
  });

  it("does not report logout success when ledger revocation fails", async () => {
    const fixture = createHandlerFixture();
    fixture.revokeOperation.mockRejectedValueOnce(
      new Error("synthetic database unavailable"),
    );
    const csrfToken = issueOwnerCsrfToken();
    const response = await logoutHandler(
      fixture,
      csrfToken,
    )(ownerLogoutRequest(csrfToken));
    expect(response.status).toBe(503);
    expect(await ownerResponseBody(response)).toMatchObject({
      code: "SERVICE_UNAVAILABLE",
    });
    expect(fixture.securityCookies.clear).toHaveBeenCalledTimes(1);
    expect(fixture.auth.signOut).toHaveBeenCalledWith({ scope: "local" });
  });

  it("rejects a false revocation result instead of reporting success", async () => {
    const fixture = createHandlerFixture();
    fixture.revokeOperation.mockResolvedValueOnce(false);
    const csrfToken = issueOwnerCsrfToken();
    const response = await logoutHandler(
      fixture,
      csrfToken,
    )(ownerLogoutRequest(csrfToken));
    expect(response.status).toBe(503);
    expect(fixture.securityCookies.clear).toHaveBeenCalledTimes(1);
    expect(fixture.auth.signOut).toHaveBeenCalledWith({ scope: "local" });
  });

  it("reports success once the ledger is revoked despite cleanup errors", async () => {
    const fixture = createHandlerFixture({
      signOutError: { name: "AuthRetryableFetchError", status: 503 },
    });
    const csrfToken = issueOwnerCsrfToken();
    const response = await logoutHandler(
      fixture,
      csrfToken,
    )(ownerLogoutRequest(csrfToken));
    expect(response.status).toBe(200);
    expect(await ownerResponseBody(response)).toEqual({
      code: "OWNER_SESSION_ENDED",
    });
  });
});

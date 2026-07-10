import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { requireFreshBoundOwnerIdentity } from "@/lib/server/auth/freshOwnerSession.ts";
import { issueOwnerSessionBinding } from "@/lib/server/auth/sessionBinding.ts";
import {
  accessToken,
  now,
  secret,
  sessionId,
  setup,
  userId,
} from "./fresh-owner-session-fixture.ts";

describe("fresh bound owner identity", () => {
  it("returns an identity without database authorization", async () => {
    const fixture = setup();
    await expect(
      requireFreshBoundOwnerIdentity({
        auth: fixture.auth,
        bindingToken: fixture.bindingToken,
        bindingSecret: secret,
        now,
      }),
    ).resolves.toEqual({ ok: true, userId, sessionId });
    expect(fixture.getSession).toHaveBeenCalledOnce();
    expect(fixture.getUser).toHaveBeenCalledWith(accessToken());
    expect(fixture.authorizeSession).not.toHaveBeenCalled();
  });

  it.each([
    [
      "invalid session error",
      setup({
        sessionError: {
          name: "AuthSessionMissingError",
          status: 400,
          code: "session_not_found",
        },
      }),
      { status: 401, code: "OWNER_SESSION_REQUIRED" },
    ],
    [
      "session rate limit",
      setup({
        sessionError: {
          name: "AuthApiError",
          status: 429,
          code: "over_request_rate_limit",
        },
      }),
      { status: 429, code: "RATE_LIMITED" },
    ],
    [
      "session outage",
      setup({ sessionError: { name: "AuthRetryableFetchError", status: 503 } }),
      { status: 503, code: "SERVICE_UNAVAILABLE" },
    ],
  ])("maps a returned %s exactly", async (_label, fixture, expected) => {
    await expect(
      requireFreshBoundOwnerIdentity({
        auth: fixture.auth,
        bindingToken: fixture.bindingToken,
        bindingSecret: secret,
        now,
      }),
    ).resolves.toEqual({ ok: false, ...expected });
    expect(fixture.getUser).not.toHaveBeenCalled();
  });

  it("maps thrown auth operations to service unavailable", async () => {
    const sessionFixture = setup();
    sessionFixture.getSession.mockRejectedValueOnce(new Error("offline"));
    const userFixture = setup();
    userFixture.getUser.mockRejectedValueOnce(new Error("offline"));

    for (const fixture of [sessionFixture, userFixture]) {
      await expect(
        requireFreshBoundOwnerIdentity({
          auth: fixture.auth,
          bindingToken: fixture.bindingToken,
          bindingSecret: secret,
          now,
        }),
      ).resolves.toEqual({
        ok: false,
        status: 503,
        code: "SERVICE_UNAVAILABLE",
      });
    }
  });

  it.each([
    ["missing", null],
    ["malformed", "not-a-binding"],
    [
      "wrong session",
      issueOwnerSessionBinding({
        userId,
        sessionId: "30000000-0000-4000-8000-000000000001",
        secret,
        now,
      }),
    ],
    [
      "wrong user",
      issueOwnerSessionBinding({
        userId: "30000000-0000-4000-8000-000000000001",
        sessionId,
        secret,
        now,
      }),
    ],
    [
      "expired",
      issueOwnerSessionBinding({
        userId,
        sessionId,
        secret,
        now: new Date("2034-12-31T23:59:59.000Z"),
      }),
    ],
  ])("rejects a %s HMAC binding exactly", async (_label, bindingToken) => {
    const fixture = setup();
    await expect(
      requireFreshBoundOwnerIdentity({
        auth: fixture.auth,
        bindingToken,
        bindingSecret: secret,
        now,
      }),
    ).resolves.toEqual({
      ok: false,
      status: 401,
      code: "OWNER_SESSION_REQUIRED",
    });
  });

  it("maps invalid binding configuration to service unavailable", async () => {
    const fixture = setup();
    await expect(
      requireFreshBoundOwnerIdentity({
        auth: fixture.auth,
        bindingToken: fixture.bindingToken,
        bindingSecret: "too-short",
        now,
      }),
    ).resolves.toEqual({
      ok: false,
      status: 503,
      code: "SERVICE_UNAVAILABLE",
    });
  });
});

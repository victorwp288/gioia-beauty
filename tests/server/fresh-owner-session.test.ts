import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import {
  getFreshSupabaseIdentity,
  requireFreshOwnerSession,
  type OwnerAuthVerifier,
} from "@/lib/server/auth/freshOwnerSession.ts";
import { issueOwnerSessionBinding } from "@/lib/server/auth/sessionBinding.ts";

const userId = "10000000-0000-4000-8000-000000000001";
const sessionId = "20000000-0000-4000-8000-000000000001";
const secret = "synthetic-owner-session-secret-32-bytes-minimum";
const now = new Date("2035-01-01T12:00:00.000Z");

function accessToken(overrides: Record<string, unknown> = {}) {
  const encoded = (value: unknown) =>
    Buffer.from(JSON.stringify(value), "utf8").toString("base64url");
  return `${encoded({ alg: "HS256", typ: "JWT" })}.${encoded({
    sub: userId,
    session_id: sessionId,
    ...overrides,
  })}.synthetic-signature`;
}

function setup({
  token = accessToken(),
  sessionError = null,
  userError = null,
  verifiedUserId = userId,
  owner = true,
}: {
  token?: string | null;
  sessionError?: unknown;
  userError?: unknown;
  verifiedUserId?: string | null;
  owner?: boolean;
} = {}) {
  const getSession = vi.fn(async () => ({
    data: { session: token ? { access_token: token } : null },
    error: sessionError,
  }));
  const getUser = vi.fn(async () => ({
    data: { user: verifiedUserId ? { id: verifiedUserId } : null },
    error: userError,
  }));
  const authorizeSession = vi.fn(async () =>
    owner
      ? ({ ok: true } as const)
      : ({
          ok: false,
          status: 403,
          code: "OWNER_AUTHORIZATION_REQUIRED",
        } as const),
  );
  const auth = { getSession, getUser } as OwnerAuthVerifier;
  const bindingToken = issueOwnerSessionBinding({
    userId,
    sessionId,
    secret,
    now,
  });
  return { auth, authorizeSession, bindingToken, getSession, getUser };
}

describe("fresh Supabase owner session", () => {
  it("verifies the exact access token remotely before authorizing the owner", async () => {
    const fixture = setup();
    await expect(
      requireFreshOwnerSession({
        auth: fixture.auth,
        bindingToken: fixture.bindingToken,
        bindingSecret: secret,
        authorizeSession: fixture.authorizeSession,
        now,
      }),
    ).resolves.toEqual({ ok: true, userId, sessionId });
    expect(fixture.getUser).toHaveBeenCalledWith(accessToken());
    expect(fixture.authorizeSession).toHaveBeenCalledWith({
      userId,
      sessionId,
    });
  });

  it.each([
    ["missing session", setup({ token: null })],
    [
      "session error",
      setup({
        sessionError: {
          name: "AuthSessionMissingError",
          status: 400,
          code: "session_not_found",
        },
      }),
    ],
    ["revoked user", setup({ verifiedUserId: null })],
    [
      "user error",
      setup({
        userError: {
          name: "AuthApiError",
          status: 401,
          code: "bad_jwt",
        },
      }),
    ],
    [
      "claim mismatch",
      setup({
        verifiedUserId: "30000000-0000-4000-8000-000000000001",
      }),
    ],
  ])("rejects a %s before database authorization", async (_label, fixture) => {
    await expect(
      requireFreshOwnerSession({
        auth: fixture.auth,
        bindingToken: fixture.bindingToken,
        bindingSecret: secret,
        authorizeSession: fixture.authorizeSession,
        now,
      }),
    ).resolves.toEqual({
      ok: false,
      status: 401,
      code: "OWNER_SESSION_REQUIRED",
    });
    expect(fixture.authorizeSession).not.toHaveBeenCalled();
  });

  it("rejects a missing or session-mismatched binding before authorization", async () => {
    for (const bindingToken of [null, setup().bindingToken]) {
      const fixture = setup({
        token: accessToken({
          session_id: "30000000-0000-4000-8000-000000000001",
        }),
      });
      await expect(
        requireFreshOwnerSession({
          auth: fixture.auth,
          bindingToken,
          bindingSecret: secret,
          authorizeSession: fixture.authorizeSession,
          now,
        }),
      ).resolves.toMatchObject({ ok: false, status: 401 });
      expect(fixture.authorizeSession).not.toHaveBeenCalled();
    }
  });

  it("returns 403 only for a fresh bound user whose owner row is disabled", async () => {
    const fixture = setup({ owner: false });
    await expect(
      requireFreshOwnerSession({
        auth: fixture.auth,
        bindingToken: fixture.bindingToken,
        bindingSecret: secret,
        authorizeSession: fixture.authorizeSession,
        now,
      }),
    ).resolves.toEqual({
      ok: false,
      status: 403,
      code: "OWNER_AUTHORIZATION_REQUIRED",
    });
  });

  it("fails closed for malformed JWT payloads", async () => {
    for (const token of ["not-a-jwt", "a.***.c", "a.e30.c"]) {
      const fixture = setup({ token });
      await expect(getFreshSupabaseIdentity(fixture.auth)).resolves.toEqual({
        ok: false,
        failure: "invalid",
      });
    }
  });

  it.each([
    [
      "retryable outage",
      { name: "AuthRetryableFetchError", status: 503 },
      { status: 503, code: "SERVICE_UNAVAILABLE" },
    ],
    [
      "rate limit",
      { name: "AuthApiError", status: 429, code: "over_request_rate_limit" },
      { status: 429, code: "RATE_LIMITED" },
    ],
  ])("preserves a returned %s", async (_label, userError, expected) => {
    const fixture = setup({ userError });
    await expect(
      requireFreshOwnerSession({
        auth: fixture.auth,
        bindingToken: fixture.bindingToken,
        bindingSecret: secret,
        authorizeSession: fixture.authorizeSession,
        now,
      }),
    ).resolves.toMatchObject({ ok: false, ...expected });
    expect(fixture.authorizeSession).not.toHaveBeenCalled();
  });

  it("propagates authorization storage failure for a 503 boundary", async () => {
    const fixture = setup();
    const failure = new Error("synthetic database unavailable");
    fixture.authorizeSession.mockRejectedValueOnce(failure);
    await expect(
      requireFreshOwnerSession({
        auth: fixture.auth,
        bindingToken: fixture.bindingToken,
        bindingSecret: secret,
        authorizeSession: fixture.authorizeSession,
        now,
      }),
    ).rejects.toBe(failure);
  });
});

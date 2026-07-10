import { vi } from "vitest";

import type { OwnerAuthVerifier } from "@/lib/server/auth/freshOwnerSession.ts";
import { issueOwnerSessionBinding } from "@/lib/server/auth/sessionBinding.ts";

export const userId = "10000000-0000-4000-8000-000000000001";
export const sessionId = "20000000-0000-4000-8000-000000000001";
export const secret = "synthetic-owner-session-secret-32-bytes-minimum";
export const now = new Date("2035-01-01T12:00:00.000Z");

export function accessToken(overrides: Record<string, unknown> = {}) {
  const encoded = (value: unknown) =>
    Buffer.from(JSON.stringify(value), "utf8").toString("base64url");
  return `${encoded({ alg: "HS256", typ: "JWT" })}.${encoded({
    sub: userId,
    session_id: sessionId,
    ...overrides,
  })}.synthetic-signature`;
}

export function setup({
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

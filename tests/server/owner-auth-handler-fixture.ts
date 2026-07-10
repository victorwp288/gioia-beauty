import { vi } from "vitest";

export const ownerUserId = "10000000-0000-4000-8000-000000000001";
export const ownerSessionId = "20000000-0000-4000-8000-000000000001";
export const ownerBindingSecret =
  "synthetic-owner-session-secret-32-bytes-minimum";

function accessToken() {
  const encoded = (value: unknown) =>
    Buffer.from(JSON.stringify(value), "utf8").toString("base64url");
  return `${encoded({ alg: "HS256", typ: "JWT" })}.${encoded({
    sub: ownerUserId,
    session_id: ownerSessionId,
  })}.synthetic-signature`;
}

export function createHandlerFixture({
  signInError = null,
  signOutError = null,
  owner = true,
  userError = null,
}: {
  signInError?: unknown;
  signOutError?: unknown;
  owner?: boolean;
  userError?: unknown;
} = {}) {
  const token = accessToken();
  const auth = {
    signInWithPassword: vi.fn(async () => ({ error: signInError })),
    getSession: vi.fn(async () => ({
      data: { session: { access_token: token } },
      error: null,
    })),
    getUser: vi.fn(async () => ({
      data: { user: { id: ownerUserId } },
      error: userError,
    })),
    signOut: vi.fn(async () => ({ error: signOutError })),
  };
  const securityCookies = { set: vi.fn(), clear: vi.fn() };
  const sessionOperation = vi.fn(async () =>
    owner
      ? ({ ok: true } as const)
      : ({
          ok: false,
          status: 403,
          code: "OWNER_AUTHORIZATION_REQUIRED",
        } as const),
  );
  const revokeOperation = vi.fn(async () => true);
  return {
    accessToken: token,
    auth,
    securityCookies,
    sessionOperation,
    revokeOperation,
  };
}

export function ownerLoginRequest(
  origin = "https://app.example.test",
  query = "",
) {
  return new Request(`https://app.example.test/api/auth/login${query}`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      host: "app.example.test",
      origin,
    },
    body: JSON.stringify({
      email: " OWNER@EXAMPLE.TEST ",
      password: "synthetic-password",
    }),
  });
}

export function ownerLogoutRequest(
  csrfToken: string,
  origin = "https://app.example.test",
  query = "",
) {
  return new Request(`https://app.example.test/api/auth/logout${query}`, {
    method: "POST",
    headers: {
      host: "app.example.test",
      origin,
      "x-csrf-token": csrfToken,
    },
  });
}

export function ownerSessionRequest(query = "") {
  return new Request(`https://app.example.test/api/auth/session${query}`);
}

export async function ownerResponseBody(response: Response) {
  return (await response.json()) as Record<string, unknown>;
}

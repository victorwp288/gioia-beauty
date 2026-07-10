import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import type { CookieMethodsServer } from "@supabase/ssr";
import type { SupabaseClient } from "@supabase/supabase-js";

import {
  OWNER_AUTH_REQUEST_TIMEOUT_MS,
  OwnerAuthConfigurationError,
  boundedOwnerAuthFetch,
  createOwnerAuthClient,
  type OwnerAuthClientOptions,
} from "@/lib/server/auth/supabaseAuthClient.ts";

const remoteEnvironment = {
  NEXT_PUBLIC_SUPABASE_URL: "https://synthetic-project.supabase.co",
  NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY:
    "sb_publishable_synthetic_owner_auth_test_key",
};

function setup(
  env: Readonly<Record<string, string | undefined>> = remoteEnvironment,
) {
  const cookies: CookieMethodsServer = {
    getAll: vi.fn(() => [{ name: "existing", value: "cookie" }]),
    setAll: vi.fn(),
  };
  const auth = { getUser: vi.fn() };
  const clientFactory = vi.fn<
    NonNullable<OwnerAuthClientOptions["clientFactory"]>
  >(() => ({ auth }) as unknown as SupabaseClient);
  const client = createOwnerAuthClient({ cookies, env, clientFactory });
  return { auth, client, clientFactory, cookies };
}

describe("request-scoped owner auth client", () => {
  it("exposes only Auth with secure server-managed cookies remotely", () => {
    const { auth, client, clientFactory, cookies } = setup();

    expect(client).toEqual({ auth });
    expect(Object.isFrozen(client)).toBe(true);
    expect("from" in client).toBe(false);
    expect(clientFactory).toHaveBeenCalledWith(
      "https://synthetic-project.supabase.co/",
      remoteEnvironment.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY,
      expect.objectContaining({
        global: { fetch: boundedOwnerAuthFetch },
        cookies,
        cookieEncoding: "base64url",
        cookieOptions: {
          httpOnly: true,
          path: "/",
          sameSite: "lax",
          secure: true,
        },
      }),
    );
  });

  it("bounds Auth fetches and preserves an upstream abort signal", async () => {
    const fetchSpy = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(new Response(null, { status: 204 }));
    const timeoutController = new AbortController();
    const timeoutSpy = vi
      .spyOn(AbortSignal, "timeout")
      .mockReturnValue(timeoutController.signal);
    const controller = new AbortController();
    await boundedOwnerAuthFetch("https://synthetic-project.supabase.co/auth", {
      signal: controller.signal,
    });
    const appliedSignal = fetchSpy.mock.calls[0]?.[1]?.signal;
    expect(OWNER_AUTH_REQUEST_TIMEOUT_MS).toBe(10_000);
    expect(timeoutSpy).toHaveBeenCalledWith(OWNER_AUTH_REQUEST_TIMEOUT_MS);
    expect(appliedSignal).toBeInstanceOf(AbortSignal);
    expect(appliedSignal?.aborted).toBe(false);
    controller.abort();
    expect(appliedSignal?.aborted).toBe(true);
    timeoutSpy.mockRestore();
    fetchSpy.mockRestore();
  });

  it("allows only loopback HTTP and marks its cookies non-secure", () => {
    const { clientFactory } = setup({
      NEXT_PUBLIC_SUPABASE_URL: "http://127.0.0.1:54321",
      NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: "local-synthetic-publishable-key",
    });

    expect(clientFactory.mock.calls[0]?.[2]).toMatchObject({
      cookieOptions: { secure: false },
    });
  });

  it.each([
    [undefined, remoteEnvironment.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY],
    ["http://remote.example.test", "local-synthetic-publishable-key"],
    ["https://user:secret@remote.example.test", "synthetic-key-1234"],
    ["https://remote.example.test/rest/v1", "synthetic-key-1234"],
    [remoteEnvironment.NEXT_PUBLIC_SUPABASE_URL, "short"],
  ])("fails closed for malformed configuration", (url, key) => {
    const secretValue = `${key ?? "missing"}`;
    expect(() =>
      setup({
        NEXT_PUBLIC_SUPABASE_URL: url,
        NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: key,
      }),
    ).toThrow(OwnerAuthConfigurationError);
    try {
      setup({
        NEXT_PUBLIC_SUPABASE_URL: url,
        NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: key,
      });
    } catch (error) {
      expect(String(error)).not.toContain(secretValue);
    }
  });
});

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  createServerClient: vi.fn(),
  getUser: vi.fn(),
}));

vi.mock("@supabase/ssr", () => ({
  createServerClient: mocks.createServerClient,
}));
vi.mock("server-only", () => ({}));

import { NextRequest } from "next/server";

import { boundedOwnerAuthFetch } from "@/lib/server/auth/supabaseAuthClient.ts";
import { config, middleware } from "@/middleware.ts";

const originalUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const originalKey = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;

describe("owner Auth middleware", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    delete process.env.NEXT_PUBLIC_SUPABASE_URL;
    delete process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
    mocks.createServerClient.mockReturnValue({
      auth: { getUser: mocks.getUser },
    });
    mocks.getUser.mockResolvedValue({ data: { user: null }, error: null });
  });

  afterEach(() => {
    if (originalUrl === undefined) delete process.env.NEXT_PUBLIC_SUPABASE_URL;
    else process.env.NEXT_PUBLIC_SUPABASE_URL = originalUrl;
    if (originalKey === undefined)
      delete process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
    else process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY = originalKey;
  });

  it("refreshes only dashboard navigation in the Node runtime", () => {
    expect(config).toEqual({
      matcher: ["/dashboard/:path*"],
      runtime: "nodejs",
    });
  });

  it("keeps owner surfaces private when Auth is not configured", async () => {
    const response = await middleware(
      new NextRequest("https://app.example.test/dashboard"),
    );
    expect(response.headers.get("cache-control")).toContain("no-store");
    expect(response.headers.get("pragma")).toBe("no-cache");
    expect(mocks.createServerClient).not.toHaveBeenCalled();
    expect(mocks.getUser).not.toHaveBeenCalled();
  });

  it.each([
    [" https://project.supabase.co", "synthetic-publishable-key"],
    ["http://remote.example.test", "synthetic-publishable-key"],
    ["https://user:secret@project.supabase.co", "synthetic-publishable-key"],
    ["https://project.supabase.co/auth/v1", "synthetic-publishable-key"],
    ["https://project.supabase.co", "short"],
  ])(
    "rejects malformed Auth configuration before SDK work",
    async (url, key) => {
      process.env.NEXT_PUBLIC_SUPABASE_URL = url;
      process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY = key;

      const response = await middleware(
        new NextRequest("https://app.example.test/dashboard"),
      );

      expect(response.headers.get("cache-control")).toContain("no-store");
      expect(mocks.createServerClient).not.toHaveBeenCalled();
      expect(mocks.getUser).not.toHaveBeenCalled();
      expect(JSON.stringify([...response.headers])).not.toContain(key);
    },
  );

  it("uses the bounded shared client and preserves every refreshed cookie", async () => {
    process.env.NEXT_PUBLIC_SUPABASE_URL = "https://project.supabase.co";
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY =
      "synthetic-publishable-key";
    mocks.createServerClient.mockImplementation((_url, _key, options) => {
      mocks.getUser.mockImplementation(async () => {
        await options.cookies.setAll(
          [
            {
              name: "sb-project-auth-token",
              value: "synthetic-access-cookie",
              options: { httpOnly: true, path: "/" },
            },
            {
              name: "sb-project-refresh-token",
              value: "synthetic-refresh-cookie",
              options: { httpOnly: true, path: "/" },
            },
          ],
          {
            "cache-control": "public, max-age=3600",
            "x-supabase-auth": "refreshed",
          },
        );
        return { data: { user: null }, error: null };
      });
      return { auth: { getUser: mocks.getUser } };
    });

    const request = new NextRequest("https://app.example.test/dashboard");
    const response = await middleware(request);
    expect(response.headers.get("cache-control")).toContain("no-store");
    expect(response.headers.get("x-supabase-auth")).toBe("refreshed");
    expect(response.cookies.get("sb-project-auth-token")?.value).toBe(
      "synthetic-access-cookie",
    );
    expect(response.cookies.get("sb-project-refresh-token")?.value).toBe(
      "synthetic-refresh-cookie",
    );
    expect(request.cookies.get("sb-project-auth-token")?.value).toBe(
      "synthetic-access-cookie",
    );
    expect(mocks.createServerClient).toHaveBeenCalledTimes(1);
    expect(mocks.createServerClient).toHaveBeenCalledWith(
      "https://project.supabase.co/",
      "synthetic-publishable-key",
      expect.objectContaining({
        global: { fetch: boundedOwnerAuthFetch },
        cookieEncoding: "base64url",
        cookieOptions: {
          httpOnly: true,
          path: "/",
          sameSite: "lax",
          secure: true,
        },
      }),
    );
    expect(mocks.getUser).toHaveBeenCalledTimes(1);
  });

  it("redacts Auth failures and still fails closed", async () => {
    process.env.NEXT_PUBLIC_SUPABASE_URL = "https://project.supabase.co";
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY =
      "synthetic-publishable-key";
    mocks.getUser.mockRejectedValue(
      new Error("customer@example.test private Auth response"),
    );

    const response = await middleware(
      new NextRequest("https://app.example.test/dashboard"),
    );
    expect(mocks.getUser).toHaveBeenCalledTimes(1);
    expect(response.headers.get("cache-control")).toContain("no-store");
    expect(await response.text()).toBe("");
    expect(JSON.stringify([...response.headers])).not.toContain(
      "customer@example.test",
    );
  });
});

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  createServerClient: vi.fn(),
  getUser: vi.fn(),
}));

vi.mock("@supabase/ssr", () => ({
  createServerClient: mocks.createServerClient,
}));

import { NextRequest } from "next/server";

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
  });

  it("refreshes Auth cookies without making the owner response cacheable", async () => {
    process.env.NEXT_PUBLIC_SUPABASE_URL = "https://project.supabase.co";
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY =
      "synthetic-publishable-key";
    mocks.createServerClient.mockImplementation((_url, _key, options) => ({
      auth: {
        getUser: vi.fn(async () => {
          await options.cookies.setAll(
            [
              {
                name: "sb-project-auth-token",
                value: "synthetic-cookie",
                options: { httpOnly: true, path: "/" },
              },
            ],
            { "x-supabase-auth": "refreshed" },
          );
          return { data: { user: null }, error: null };
        }),
      },
    }));

    const response = await middleware(
      new NextRequest("https://app.example.test/dashboard"),
    );
    expect(response.headers.get("cache-control")).toContain("no-store");
    expect(response.headers.get("x-supabase-auth")).toBe("refreshed");
    expect(response.cookies.get("sb-project-auth-token")?.value).toBe(
      "synthetic-cookie",
    );
    expect(mocks.createServerClient).toHaveBeenCalledTimes(1);
  });
});

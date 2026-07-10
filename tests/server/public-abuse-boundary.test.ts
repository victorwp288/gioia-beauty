import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { validateEnvironment } from "@/config/environment.mjs";
import {
  createPublicAbuseGuard,
  evaluatePublicAbuseGuard,
  publicAbuseGuard,
  publicAbuseRejectionResponse,
  type PublicAbuseGuard,
  type PublicAbuseRejection,
} from "@/lib/server/publicAbuseBoundary.ts";
import { requestPrincipalScopeHash } from "@/lib/server/bookingSecurity.ts";

const REQUEST_ID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const PROJECT_REF = "lxvsspniipcotimbsfqm";

function isolatedEnvironment(
  appEnv: "local" | "test" = "test",
  overrides: Record<string, string | undefined> = {},
): Record<string, string | undefined> {
  return {
    APP_ENV: appEnv,
    NEXT_PUBLIC_APP_ENV: appEnv,
    EMAIL_TRANSPORT: "fake",
    EMAIL_WEBHOOK_ENABLED: "false",
    BOOKING_HMAC_SECRET: "a".repeat(32),
    ...overrides,
  };
}

function previewEnvironment() {
  return {
    APP_ENV: "preview",
    NEXT_PUBLIC_APP_ENV: "preview",
    VERCEL_ENV: "preview",
    EMAIL_TRANSPORT: "fake",
    EMAIL_WEBHOOK_ENABLED: "false",
    BOOKING_HMAC_SECRET: "b".repeat(32),
    OWNER_SESSION_HMAC_SECRET: "c".repeat(32),
    SUPABASE_PROJECT_REF: PROJECT_REF,
    NEXT_PUBLIC_SUPABASE_URL: `https://${PROJECT_REF}.supabase.co`,
    NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: `sb_publishable_${"p".repeat(24)}`,
    SUPABASE_DATABASE_URL:
      `postgresql://app_runtime.${PROJECT_REF}:synthetic@` +
      "aws-0-eu-central-2.pooler.supabase.com:6543/postgres",
  };
}

function request() {
  return new Request("https://www.gioiabeauty.net/api/bookings", {
    headers: { "x-forwarded-for": "192.0.2.10" },
  });
}

describe("public abuse boundary", () => {
  it.each(["local", "test"] as const)(
    "allows the stateless %s fake and returns only a 32-byte hash",
    async (appEnv) => {
      const env = isolatedEnvironment(appEnv);
      expect(validateEnvironment(env).ok).toBe(true);

      const decision = await evaluatePublicAbuseGuard(
        createPublicAbuseGuard(env),
        request(),
        "public_booking",
      );

      expect(decision.ok).toBe(true);
      if (!decision.ok) throw new Error("Expected an allowed decision");
      expect(decision.principalScopeHash).toBeInstanceOf(Buffer);
      expect(decision.principalScopeHash).toHaveLength(32);
      expect(decision.principalScopeHash.toString("hex")).not.toContain(
        "192.0.2.10",
      );
    },
  );

  it("binds principal hashing to the exact environment passed to the factory", async () => {
    const firstEnv = isolatedEnvironment("test", {
      BOOKING_HMAC_SECRET: "d".repeat(32),
    });
    const secondEnv = isolatedEnvironment("test", {
      BOOKING_HMAC_SECRET: "e".repeat(32),
    });
    const firstRequest = request();
    const secondRequest = request();

    const first = await evaluatePublicAbuseGuard(
      createPublicAbuseGuard(firstEnv),
      firstRequest,
      "public_availability",
    );
    const second = await evaluatePublicAbuseGuard(
      createPublicAbuseGuard(secondEnv),
      secondRequest,
      "public_availability",
    );

    expect(first.ok).toBe(true);
    expect(second.ok).toBe(true);
    if (!first.ok || !second.ok) throw new Error("Expected allowed decisions");
    expect(first.principalScopeHash).toEqual(
      requestPrincipalScopeHash(request(), firstEnv),
    );
    expect(second.principalScopeHash).toEqual(
      requestPrincipalScopeHash(request(), secondEnv),
    );
    expect(first.principalScopeHash).not.toEqual(second.principalScopeHash);
  });

  it("revalidates its environment for every request", async () => {
    const env = isolatedEnvironment("test");
    const guard = createPublicAbuseGuard(env);

    expect(
      await evaluatePublicAbuseGuard(guard, request(), "public_availability"),
    ).toMatchObject({ ok: true });

    env.APP_ENV = "preview";
    expect(
      await evaluatePublicAbuseGuard(guard, request(), "public_availability"),
    ).toEqual({
      ok: false,
      status: 503,
      code: "SERVICE_UNAVAILABLE",
    });
  });

  it("code-disables valid Preview and invalid remote environments before hash work", async () => {
    const preview = previewEnvironment();
    expect(validateEnvironment(preview).ok).toBe(true);

    for (const env of [
      preview,
      {
        APP_ENV: "production",
        NEXT_PUBLIC_APP_ENV: "production",
        EMAIL_TRANSPORT: "resend",
      },
      {
        APP_ENV: "operator",
        NEXT_PUBLIC_APP_ENV: "operator",
        EMAIL_TRANSPORT: "fake",
      },
      { APP_ENV: "unknown" },
    ]) {
      const guardedRequest = request();
      const getHeader = vi.spyOn(guardedRequest.headers, "get");
      const decision = await createPublicAbuseGuard(env).check(
        guardedRequest,
        "public_booking",
      );

      expect(decision).toEqual({
        ok: false,
        status: 503,
        code: "SERVICE_UNAVAILABLE",
      });
      expect(getHeader).not.toHaveBeenCalled();
    }
  });

  it("fails closed on an unsupported runtime action without hashing", async () => {
    const guardedRequest = request();
    const getHeader = vi.spyOn(guardedRequest.headers, "get");
    const decision = await createPublicAbuseGuard(
      isolatedEnvironment("test"),
    ).check(guardedRequest, "public_unknown" as "public_booking");

    expect(decision).toEqual({
      ok: false,
      status: 503,
      code: "SERVICE_UNAVAILABLE",
    });
    expect(getHeader).not.toHaveBeenCalled();
  });

  it.each([
    {
      ok: false,
      status: 403,
      code: "HUMAN_VERIFICATION_REQUIRED",
    },
    {
      ok: false,
      status: 429,
      code: "RATE_LIMITED",
      retryAfterSeconds: 60,
    },
    { ok: false, status: 503, code: "SERVICE_UNAVAILABLE" },
  ] as const)("normalizes the fixed rejection decision %#", async (raw) => {
    const guard: PublicAbuseGuard = { check: vi.fn(async () => raw) };
    await expect(
      evaluatePublicAbuseGuard(guard, request(), "public_booking"),
    ).resolves.toEqual(raw);
  });

  it("clones an accepted principal hash before returning it", async () => {
    const source = Buffer.alloc(32, 7);
    const guard: PublicAbuseGuard = {
      check: vi.fn(async () => ({ ok: true, principalScopeHash: source })),
    };
    const decision = await evaluatePublicAbuseGuard(
      guard,
      request(),
      "public_booking",
    );

    expect(decision.ok).toBe(true);
    if (!decision.ok) throw new Error("Expected an allowed decision");
    expect(decision.principalScopeHash).not.toBe(source);
    source.fill(9);
    expect(decision.principalScopeHash).toEqual(Buffer.alloc(32, 7));
  });

  it.each([
    undefined,
    null,
    {},
    { ok: true, principalScopeHash: Buffer.alloc(31) },
    { ok: true, principalScopeHash: Buffer.alloc(32), extra: true },
    {
      ok: false,
      status: 403,
      code: "HUMAN_VERIFICATION_REQUIRED",
      extra: "secret",
    },
    {
      ok: false,
      status: 429,
      code: "RATE_LIMITED",
      retryAfterSeconds: 0,
    },
    {
      ok: false,
      status: 429,
      code: "RATE_LIMITED",
      retryAfterSeconds: 3_601,
    },
    {
      ok: false,
      status: 429,
      code: "RATE_LIMITED",
      retryAfterSeconds: 1.5,
    },
    { ok: false, status: 503, code: "secret@example.test" },
  ])("redacts a malformed or non-strict decision %#", async (raw) => {
    const guard: PublicAbuseGuard = { check: vi.fn(async () => raw) };
    await expect(
      evaluatePublicAbuseGuard(guard, request(), "public_booking"),
    ).resolves.toEqual({
      ok: false,
      status: 503,
      code: "SERVICE_UNAVAILABLE",
    });
  });

  it("redacts guard errors to the fixed unavailable decision", async () => {
    const guard: PublicAbuseGuard = {
      check: vi.fn(async () => {
        throw new Error("secret@example.test provider details");
      }),
    };

    await expect(
      evaluatePublicAbuseGuard(guard, request(), "public_booking"),
    ).resolves.toEqual({
      ok: false,
      status: 503,
      code: "SERVICE_UNAVAILABLE",
    });
  });

  it.each([
    [
      {
        ok: false,
        status: 403,
        code: "HUMAN_VERIFICATION_REQUIRED",
      },
      null,
    ],
    [
      {
        ok: false,
        status: 429,
        code: "RATE_LIMITED",
        retryAfterSeconds: 90,
      },
      "90",
    ],
    [{ ok: false, status: 503, code: "SERVICE_UNAVAILABLE" }, null],
  ] as const)(
    "renders hardened status $0.status without leaking boundary details",
    async (decision, retryAfter) => {
      const response = publicAbuseRejectionResponse(
        decision as PublicAbuseRejection,
        REQUEST_ID,
      );

      expect(response.status).toBe(decision.status);
      expect(await response.json()).toEqual({
        code: decision.code,
        requestId: REQUEST_ID,
      });
      expect(response.headers.get("retry-after")).toBe(retryAfter);
      expect(response.headers.get("cache-control")).toContain("no-store");
      expect(response.headers.get("content-security-policy")).toBe(
        "default-src 'none'; frame-ancestors 'none'",
      );
      expect(response.headers.get("cross-origin-resource-policy")).toBe(
        "same-origin",
      );
      expect(response.headers.get("x-content-type-options")).toBe("nosniff");
    },
  );

  it("exports one runtime singleton guard", () => {
    expect(publicAbuseGuard.check).toEqual(expect.any(Function));
  });
});

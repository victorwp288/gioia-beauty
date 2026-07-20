import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { validateEnvironment } from "@/config/environment.mjs";
import {
  createDatabasePublicAbuseGuard,
  createLocalTestHumanChallengeVerifier,
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
const HUMAN_TOKEN = Buffer.alloc(32, 0x4a).toString("base64url");

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
    PAGINATION_CURSOR_KEYRING_JSON: JSON.stringify({
      activeKeyId: "preview_1",
      keys: [
        {
          id: "preview_1",
          secret: Buffer.alloc(32, 9).toString("base64url"),
        },
      ],
    }),
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
    {
      ok: false,
      status: 429,
      code: "RATE_LIMITED",
      retryAfterSeconds: 86_400,
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
      retryAfterSeconds: 86_401,
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

  it("uses only an explicit Local/Test fake challenge token and fails closed otherwise", async () => {
    const env = isolatedEnvironment("test", {
      PUBLIC_HUMAN_CHALLENGE_TEST_TOKEN: HUMAN_TOKEN,
    });
    const verifier = createLocalTestHumanChallengeVerifier(env);

    await expect(
      verifier.verify(
        {
          headers: new Headers({
            "x-gioia-human-challenge": HUMAN_TOKEN,
          }),
        },
        "public_booking",
      ),
    ).resolves.toEqual({ verified: true });
    await expect(
      verifier.verify(
        {
          headers: new Headers({
            "x-gioia-human-challenge": Buffer.alloc(32, 0x4b).toString(
              "base64url",
            ),
          }),
        },
        "public_booking",
      ),
    ).resolves.toEqual({ verified: false });
    await expect(
      verifier.verify(
        {
          headers: new Headers({
            "x-gioia-human-challenge": `${HUMAN_TOKEN.slice(0, -1)}B`,
          }),
        },
        "public_booking",
      ),
    ).resolves.toEqual({ verified: false });
    await expect(
      createLocalTestHumanChallengeVerifier({
        ...previewEnvironment(),
        PUBLIC_HUMAN_CHALLENGE_TEST_TOKEN: HUMAN_TOKEN,
      }).verify(
        { headers: new Headers({ "x-gioia-human-challenge": HUMAN_TOKEN }) },
        "public_booking",
      ),
    ).resolves.toEqual({ verified: false });
  });

  it("consumes bounded network and normalized account scopes with challenge evidence", async () => {
    const consume = vi.fn(async (_input: unknown) => ({
      decision: "allowed" as const,
      allowed: true,
      remaining: 1,
      retryAfterSeconds: 0,
      humanVerificationRequired: false,
    }));
    const env = isolatedEnvironment("test", {
      PUBLIC_HUMAN_CHALLENGE_TEST_TOKEN: HUMAN_TOKEN,
    });
    const verify = vi.fn(async () => ({ verified: true }));
    const guard = createDatabasePublicAbuseGuard({ consume }, env, { verify });
    const metadata = {
      headers: new Headers({
        "x-forwarded-for": "192.0.2.10",
        "x-gioia-human-challenge": HUMAN_TOKEN,
      }),
    };

    const network = await guard.check(metadata, "public_booking");
    expect(network).toMatchObject({ ok: true, humanVerified: true });
    await expect(
      guard.check(metadata, "public_booking", {
        kind: "account",
        value: "reader@example.test",
        humanVerified:
          typeof network === "object" &&
          network !== null &&
          "humanVerified" in network &&
          network.humanVerified === true,
      }),
    ).resolves.toMatchObject({ ok: true });

    expect(consume).toHaveBeenNthCalledWith(1, {
      action: "public_booking",
      scopeKind: "network",
      scopeHash: expect.any(Buffer),
      humanVerified: true,
    });
    expect(consume).toHaveBeenNthCalledWith(2, {
      action: "public_booking",
      scopeKind: "account",
      scopeHash: expect.any(Buffer),
      humanVerified: true,
    });
    expect(
      (consume.mock.calls[0]![0] as { scopeHash: Buffer }).scopeHash,
    ).not.toEqual(
      (consume.mock.calls[1]![0] as { scopeHash: Buffer }).scopeHash,
    );
    expect(verify).toHaveBeenCalledOnce();
  });

  it("hashes a valid maximum-length normalized account independently of network-source limits", async () => {
    const consume = vi.fn(async (_input: unknown) => ({
      decision: "allowed" as const,
      allowed: true,
      remaining: 1,
      retryAfterSeconds: 0,
      humanVerificationRequired: false,
    }));
    const guard = createDatabasePublicAbuseGuard(
      { consume },
      isolatedEnvironment("test"),
    );
    const email = `${"a".repeat(307)}@example.test`;

    await expect(
      guard.check({ headers: new Headers() }, "public_booking", {
        kind: "account",
        value: email,
        humanVerified: false,
      }),
    ).resolves.toMatchObject({ ok: true });
    expect(Buffer.byteLength(email)).toBe(320);
    expect(consume).toHaveBeenCalledOnce();
  });

  it("rejects an action/scope mismatch before database consumption", async () => {
    const consume = vi.fn(async (_input: unknown) => ({
      decision: "allowed" as const,
      allowed: true,
      remaining: 1,
      retryAfterSeconds: 0,
      humanVerificationRequired: false,
    }));
    const guard = createDatabasePublicAbuseGuard(
      { consume },
      isolatedEnvironment("test"),
    );

    await expect(
      guard.check({ headers: new Headers() }, "public_newsletter_confirm", {
        kind: "account",
        value: "reader@example.test",
        humanVerified: false,
      }),
    ).resolves.toEqual({
      ok: false,
      status: 503,
      code: "SERVICE_UNAVAILABLE",
    });
    expect(consume).not.toHaveBeenCalled();
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

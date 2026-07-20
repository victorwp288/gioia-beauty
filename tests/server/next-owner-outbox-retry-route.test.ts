import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { requestFingerprint } from "@/lib/server/bookingSecurity.ts";
import type { OwnerOutboxRetryRepository } from "@/lib/server/database/ownerOutboxRetryRepository.ts";
import type { OwnerCommandResult } from "@/lib/server/database/ownerScheduleRepositorySupport.ts";
import {
  createNextOwnerOutboxRetryRoute,
  ownerOutboxRetryRuntimeIsSafe,
  type NextOwnerOutboxRetryRouteDependencies,
} from "@/lib/server/nextOwnerOutboxRetryRoute.ts";
import {
  now,
  secret,
  sessionId,
  setup,
  userId,
} from "./fresh-owner-session-fixture.ts";

const CSRF_TOKEN = "A".repeat(43);
const OUTBOX_ID = "30000000-0000-4000-8000-000000000001";
const IDEMPOTENCY_KEY = "40000000-0000-4000-8000-000000000001";
const REQUEST_ID = "50000000-0000-4000-8000-000000000001";
const SAFE_ENV = {
  APP_ENV: "test",
  NEXT_PUBLIC_APP_ENV: "test",
  EMAIL_TRANSPORT: "fake",
};
const SAFE_LOCAL_ENV = {
  APP_ENV: "local",
  NEXT_PUBLIC_APP_ENV: "local",
  EMAIL_TRANSPORT: "fake",
};
const SAFE_PREVIEW_ENV = {
  APP_ENV: "preview",
  NEXT_PUBLIC_APP_ENV: "preview",
  VERCEL_ENV: "preview",
  EMAIL_TRANSPORT: "fake",
  SUPABASE_PROJECT_REF: "lxvsspniipcotimbsfqm",
  NEXT_PUBLIC_SUPABASE_URL: "https://lxvsspniipcotimbsfqm.supabase.co",
  NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: "sb_publishable_synthetic_value_123456",
  SUPABASE_DATABASE_URL:
    "postgresql://app_runtime.lxvsspniipcotimbsfqm:synthetic@" +
    "aws-0-eu-central-2.pooler.supabase.com:6543/postgres",
  BOOKING_HMAC_SECRET: "synthetic-preview-booking-hmac-secret-000000000000",
  OWNER_SESSION_HMAC_SECRET:
    "synthetic-preview-owner-session-secret-000000000000",
  PAGINATION_CURSOR_KEYRING_JSON: JSON.stringify({
    activeKeyId: "preview_1",
    keys: [
      {
        id: "preview_1",
        secret: "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA",
      },
    ],
  }),
};

function success(replayed = false): OwnerCommandResult {
  return {
    http_status: 200,
    result: { code: "OUTBOX_RETRY_SCHEDULED", resource_id: OUTBOX_ID },
    replayed,
  };
}

function request({
  url = "https://preview.example.test/api/admin/outbox/retry",
  body = { outboxId: OUTBOX_ID.toUpperCase(), expectedVersion: 2 },
  headers = {},
}: {
  url?: string;
  body?: unknown;
  headers?: Record<string, string>;
} = {}) {
  return new Request(url, {
    method: "POST",
    headers: {
      host: "preview.example.test",
      origin: "https://preview.example.test",
      "content-type": "application/json",
      "idempotency-key": IDEMPOTENCY_KEY,
      "x-csrf-token": CSRF_TOKEN,
      ...headers,
    },
    body: typeof body === "string" ? body : JSON.stringify(body),
  });
}

function fixture({
  result = success(),
  env = SAFE_ENV,
  bindingToken,
  sessionError,
}: {
  result?: OwnerCommandResult;
  env?: Readonly<Record<string, string | undefined>>;
  bindingToken?: string;
  sessionError?: unknown;
} = {}) {
  const authFixture = setup({ sessionError });
  const signOut = vi.fn(async () => ({ error: null }));
  const setSecurityCookie = vi.fn();
  const retryOutbox = vi.fn(async () => result);
  const repository = { retryOutbox } satisfies OwnerOutboxRetryRepository;
  const readSecurityTokens = vi.fn(async () => ({
    bindingToken: bindingToken ?? authFixture.bindingToken,
    csrfToken: CSRF_TOKEN,
  }));
  const createAuthContext = vi.fn(async () => ({
    auth: { ...authFixture.auth, signOut } as never,
    responseHeaders: new Headers(),
    securityCookieStore: { get: vi.fn(), set: setSecurityCookie },
    secure: true,
  }));
  const dependencies = {
    repository,
    writeGate: {
      check: vi.fn(async () => ({
        ok: true as const,
        canaryToken: null,
        mode: "open" as const,
      })),
    },
    env,
    readSecurityTokens,
    createAuthContext,
    getBindingSecret: () => secret,
    createRequestId: () => REQUEST_ID,
    now,
  } satisfies NextOwnerOutboxRetryRouteDependencies;
  return {
    createAuthContext,
    dependencies,
    getSession: authFixture.getSession,
    getUser: authFixture.getUser,
    readSecurityTokens,
    retryOutbox,
    setSecurityCookie,
    signOut,
  };
}

describe("Next owner outbox retry route", () => {
  it.each([
    ["Local", SAFE_LOCAL_ENV],
    ["Test", SAFE_ENV],
    ["Preview", SAFE_PREVIEW_ENV],
  ])("accepts a fully validated %s fake-email runtime", async (_label, env) => {
    const route = fixture({ env });
    const response = await createNextOwnerOutboxRetryRoute(route.dependencies)(
      request(),
    );

    expect(response.status).toBe(200);
    expect(route.retryOutbox).toHaveBeenCalledOnce();
  });

  it.each([false, true])(
    "returns the exact retry result when replayed=%s",
    async (replayed) => {
      const route = fixture({ result: success(replayed) });
      const response = await createNextOwnerOutboxRetryRoute(
        route.dependencies,
      )(request());

      expect(response.status).toBe(200);
      expect(await response.json()).toEqual({
        code: "OUTBOX_RETRY_SCHEDULED",
        resourceId: OUTBOX_ID,
        replayed,
      });
      expect(route.retryOutbox).toHaveBeenCalledWith(
        { userId, sessionId },
        {
          outboxId: OUTBOX_ID,
          expectedVersion: 2,
          idempotencyKey: IDEMPOTENCY_KEY,
        },
        requestFingerprint({
          operation: "owner_outbox_retry",
          version: 1,
          request: { outboxId: OUTBOX_ID, expectedVersion: 2 },
        }),
        null,
      );
      expect(route.createAuthContext).toHaveBeenCalledOnce();
    },
  );

  it("preserves the PostgreSQL max integer version through fingerprinting", async () => {
    const route = fixture();
    const response = await createNextOwnerOutboxRetryRoute(route.dependencies)(
      request({
        body: { outboxId: OUTBOX_ID, expectedVersion: 2_147_483_647 },
      }),
    );

    expect(response.status).toBe(200);
    expect(route.retryOutbox).toHaveBeenCalledWith(
      { userId, sessionId },
      {
        outboxId: OUTBOX_ID,
        expectedVersion: 2_147_483_647,
        idempotencyKey: IDEMPOTENCY_KEY,
      },
      requestFingerprint({
        operation: "owner_outbox_retry",
        version: 1,
        request: { outboxId: OUTBOX_ID, expectedVersion: 2_147_483_647 },
      }),
      null,
    );
  });

  it("returns the exact stored conflict without exposing a resource", async () => {
    const route = fixture({
      result: {
        http_status: 409,
        result: { code: "OUTBOX_RETRY_CONFLICT" },
        replayed: false,
      },
    });
    const response = await createNextOwnerOutboxRetryRoute(route.dependencies)(
      request(),
    );
    expect(response.status).toBe(409);
    expect(await response.json()).toEqual({
      code: "OUTBOX_RETRY_CONFLICT",
      requestId: REQUEST_ID,
    });
  });

  it.each([
    [
      "Production",
      {
        APP_ENV: "production",
        NEXT_PUBLIC_APP_ENV: "production",
        VERCEL_ENV: "production",
        EMAIL_TRANSPORT: "resend",
      },
    ],
    [
      "operator",
      {
        APP_ENV: "operator",
        NEXT_PUBLIC_APP_ENV: "operator",
        EMAIL_TRANSPORT: "fake",
      },
    ],
    ["mislabeled Preview", { ...SAFE_PREVIEW_ENV, VERCEL_ENV: "production" }],
    [
      "wrong Preview target",
      { ...SAFE_PREVIEW_ENV, SUPABASE_PROJECT_REF: "wrong-project" },
    ],
    [
      "delivering Preview transport",
      { ...SAFE_PREVIEW_ENV, EMAIL_TRANSPORT: "resend" },
    ],
  ])(
    "hard-disables %s before cookies, body, Auth, or repository work",
    async (_label, env) => {
      const route = fixture({ env });
      const input = request();
      const getReader = vi.spyOn(input.body!, "getReader");
      const response = await createNextOwnerOutboxRetryRoute(
        route.dependencies,
      )(input);

      expect(response.status).toBe(503);
      expect(await response.json()).toEqual({
        code: "SERVICE_UNAVAILABLE",
        requestId: expect.any(String),
      });
      expect(response.headers.get("cache-control")).toBe(
        "private, no-store, max-age=0",
      );
      expect(response.headers.get("content-security-policy")).toBe(
        "default-src 'none'; frame-ancestors 'none'",
      );
      expect(route.readSecurityTokens).not.toHaveBeenCalled();
      expect(getReader).not.toHaveBeenCalled();
      expect(route.createAuthContext).not.toHaveBeenCalled();
      expect(route.retryOutbox).not.toHaveBeenCalled();
    },
  );

  it("keeps Production disabled even after a future valid registration", () => {
    expect(
      ownerOutboxRetryRuntimeIsSafe({ ok: true, appEnv: "production" }, "fake"),
    ).toBe(false);
  });

  it("rejects an injected environment unless every sensitive sink is explicit", async () => {
    const readSecurityTokens = vi.fn(async () => ({
      bindingToken: "must-not-be-read",
      csrfToken: CSRF_TOKEN,
    }));
    const createAuthContext = vi.fn();
    const retryOutbox = vi.fn();
    const input = request();
    const getReader = vi.spyOn(input.body!, "getReader");
    const response = await createNextOwnerOutboxRetryRoute({
      env: SAFE_ENV,
      repository: { retryOutbox },
      readSecurityTokens,
      createAuthContext,
      // Deliberately omit the HMAC-secret sink. Falling back to process.env
      // here would recreate the split-environment isolation bug.
    })(input);

    expect(response.status).toBe(503);
    expect(readSecurityTokens).not.toHaveBeenCalled();
    expect(getReader).not.toHaveBeenCalled();
    expect(createAuthContext).not.toHaveBeenCalled();
    expect(retryOutbox).not.toHaveBeenCalled();
  });

  it("clears signed-in state for an invalid owner binding", async () => {
    const route = fixture({ bindingToken: "invalid-binding" });
    const response = await createNextOwnerOutboxRetryRoute(route.dependencies)(
      request(),
    );

    expect(response.status).toBe(401);
    expect(route.signOut).toHaveBeenCalledWith({ scope: "local" });
    expect(route.setSecurityCookie).toHaveBeenCalledTimes(2);
    expect(route.retryOutbox).not.toHaveBeenCalled();
  });

  it("preserves Auth throttling without clearing signed-in state", async () => {
    const route = fixture({
      sessionError: {
        name: "AuthApiError",
        status: 429,
        code: "over_request_rate_limit",
      },
    });
    const response = await createNextOwnerOutboxRetryRoute(route.dependencies)(
      request(),
    );

    expect(response.status).toBe(429);
    expect(response.headers.get("retry-after")).toBe("60");
    expect(route.getUser).not.toHaveBeenCalled();
    expect(route.signOut).not.toHaveBeenCalled();
    expect(route.setSecurityCookie).not.toHaveBeenCalled();
    expect(route.retryOutbox).not.toHaveBeenCalled();
  });

  it("clears signed-in state for a database authorization rejection", async () => {
    const route = fixture();
    route.retryOutbox.mockRejectedValueOnce(
      Object.assign(new Error("OWNER_SESSION_MISMATCH"), { code: "PT403" }),
    );
    const response = await createNextOwnerOutboxRetryRoute(route.dependencies)(
      request(),
    );

    expect(response.status).toBe(403);
    expect(route.signOut).toHaveBeenCalledWith({ scope: "local" });
    expect(route.setSecurityCookie).toHaveBeenCalledTimes(2);
  });

  it("redacts an unknown repository failure", async () => {
    const route = fixture();
    route.retryOutbox.mockRejectedValueOnce({
      code: "08006",
      message: "private recipient@example.test database failure",
    });
    const response = await createNextOwnerOutboxRetryRoute(route.dependencies)(
      request(),
    );
    const text = await response.text();

    expect(response.status).toBe(503);
    expect(JSON.parse(text)).toEqual({
      code: "SERVICE_UNAVAILABLE",
      requestId: REQUEST_ID,
    });
    expect(text).not.toContain("recipient@example.test");
    expect(route.signOut).not.toHaveBeenCalled();
    expect(route.setSecurityCookie).not.toHaveBeenCalled();
  });

  it.each([
    [
      "query",
      {
        url: "https://preview.example.test/api/admin/outbox/retry?x=1",
      },
      400,
    ],
    [
      "foreign Origin before query",
      {
        url: "https://preview.example.test/api/admin/outbox/retry?x=1",
        headers: { origin: "https://attacker.example.test" },
      },
      403,
    ],
    [
      "invalid CSRF before query",
      {
        url: "https://preview.example.test/api/admin/outbox/retry?x=1",
        headers: { "x-csrf-token": "B".repeat(43) },
      },
      403,
    ],
    ["missing idempotency", { headers: { "idempotency-key": "" } }, 400],
    ["wrong media", { headers: { "content-type": "text/plain" } }, 415],
    ["encoded body", { headers: { "content-encoding": "gzip" } }, 415],
    ["invalid JSON", { body: "{not-json" }, 400],
    [
      "invalid version",
      { body: { outboxId: OUTBOX_ID, expectedVersion: 2_147_483_648 } },
      422,
    ],
  ])(
    "rejects $label before Auth or repository work",
    async (_label, options, status) => {
      const route = fixture();
      const response = await createNextOwnerOutboxRetryRoute(
        route.dependencies,
      )(request(options));

      expect(response.status).toBe(status);
      expect(route.createAuthContext).not.toHaveBeenCalled();
      expect(route.retryOutbox).not.toHaveBeenCalled();
      expect(route.setSecurityCookie).not.toHaveBeenCalled();
      expect(route.signOut).not.toHaveBeenCalled();
    },
  );
});

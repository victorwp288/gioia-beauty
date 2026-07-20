import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import type { PublicAbuseGuard } from "@/lib/server/publicAbuseBoundary.ts";
import { createPublicNewsletterActionPostHandler } from "@/lib/server/publicNewsletterActionHandler.ts";
import { createPublicNewsletterSubscribePostHandler } from "@/lib/server/publicNewsletterSubscribeHandler.ts";
import {
  CLAIMS,
  NOW,
  codec,
  issue,
} from "./newsletter-action-token-fixture.ts";

const REQUEST_ID = "10000000-0000-4000-8000-000000000001";
const IDEMPOTENCY_KEY = "20000000-0000-4000-8000-000000000002";
const CSRF = Buffer.alloc(32, 7).toString("base64url");
const PRINCIPAL = Buffer.alloc(32, 8);

function guard(
  decision: unknown = { ok: true, principalScopeHash: PRINCIPAL },
) {
  const check = vi.fn(async () => decision);
  return { check } as PublicAbuseGuard & { check: typeof check };
}

function request(path: string, body: unknown, headers: HeadersInit = {}) {
  return new Request(`https://example.test${path}`, {
    method: "POST",
    headers: {
      host: "example.test",
      origin: "https://example.test",
      "content-type": "application/json",
      "idempotency-key": IDEMPOTENCY_KEY,
      ...Object.fromEntries(new Headers(headers)),
    },
    body: JSON.stringify(body),
  });
}

async function json(response: Response) {
  return JSON.parse(await response.text()) as Record<string, unknown>;
}

describe("public newsletter subscribe boundary", () => {
  it("normalizes one bounded command and returns no enumeration metadata", async () => {
    const subscribe = vi.fn(async (_input: unknown) => ({
      httpStatus: 202,
      code: "REQUEST_ACCEPTED",
      replayed: true,
    }));
    const abuseGuard = guard();
    const handler = createPublicNewsletterSubscribePostHandler({
      repository: { subscribe },
      abuseGuard,
      createRequestId: () => REQUEST_ID,
    });

    const response = await handler(
      request("/api/newsletter/subscribe", {
        email: " READER@EXAMPLE.TEST ",
        consent: true,
      }),
    );

    expect(response.status).toBe(202);
    expect(await json(response)).toEqual({ code: "REQUEST_ACCEPTED" });
    expect(abuseGuard.check).toHaveBeenCalledWith(
      expect.anything(),
      "public_newsletter_subscribe",
    );
    expect(abuseGuard.check).toHaveBeenCalledWith(
      expect.anything(),
      "public_newsletter_subscribe",
      {
        kind: "account",
        value: "reader@example.test",
        humanVerified: false,
      },
    );
    expect(subscribe).toHaveBeenCalledOnce();
    expect(subscribe.mock.calls[0]![0]).toMatchObject({
      principalScopeHash: PRINCIPAL,
      command: {
        idempotencyKey: IDEMPOTENCY_KEY,
        email: "reader@example.test",
        consent: true,
      },
      requestFingerprint: expect.any(Buffer),
    });
  });

  it("rejects origin and abuse failures before repository work", async () => {
    const subscribe = vi.fn();
    const blockedGuard = guard({
      ok: false,
      status: 429,
      code: "RATE_LIMITED",
      retryAfterSeconds: 30,
    });
    const blocked = createPublicNewsletterSubscribePostHandler({
      repository: { subscribe },
      abuseGuard: blockedGuard,
      createRequestId: () => REQUEST_ID,
    });
    const badOrigin = request(
      "/api/newsletter/subscribe",
      { email: "reader@example.test", consent: true },
      { origin: "https://attacker.test" },
    );
    expect((await blocked(badOrigin)).status).toBe(403);
    expect(blockedGuard.check).not.toHaveBeenCalled();

    const rateLimited = await blocked(
      request("/api/newsletter/subscribe", {
        email: "reader@example.test",
        consent: true,
      }),
    );
    expect(rateLimited.status).toBe(429);
    expect(rateLimited.headers.get("retry-after")).toBe("30");
    expect(subscribe).not.toHaveBeenCalled();
  });

  it("silently contains an account-scoped rejection without enumerating", async () => {
    const subscribe = vi.fn();
    const abuseGuard = guard();
    abuseGuard.check
      .mockResolvedValueOnce({
        ok: true,
        principalScopeHash: PRINCIPAL,
      })
      .mockResolvedValueOnce({
        ok: false,
        status: 429,
        code: "RATE_LIMITED",
        retryAfterSeconds: 90,
      });
    const handler = createPublicNewsletterSubscribePostHandler({
      repository: { subscribe },
      abuseGuard,
      createRequestId: () => REQUEST_ID,
    });

    const response = await handler(
      request("/api/newsletter/subscribe", {
        email: "reader@example.test",
        consent: true,
      }),
    );

    expect(response.status).toBe(202);
    expect(await json(response)).toEqual({ code: "REQUEST_ACCEPTED" });
    expect(response.headers.get("retry-after")).toBeNull();
    expect(subscribe).not.toHaveBeenCalled();
  });
});

describe("public newsletter action boundary", () => {
  function setup(
    action: "confirm" | "unsubscribe" = "confirm",
    selectedCodec = codec(),
  ) {
    const confirm = vi.fn(async (_input: unknown) => ({
      httpStatus: 202,
      code: "REQUEST_ACCEPTED",
      replayed: false,
    }));
    const unsubscribe = vi.fn(async (_input: unknown) => ({
      httpStatus: 202,
      code: "REQUEST_ACCEPTED",
      replayed: false,
    }));
    const abuseGuard = guard();
    return {
      confirm,
      unsubscribe,
      abuseGuard,
      handler: createPublicNewsletterActionPostHandler({
        action,
        repository: { confirm, unsubscribe },
        tokenCodec: selectedCodec,
        abuseGuard,
        readCsrfCookie: () => CSRF,
        now: () => NOW,
        createRequestId: () => REQUEST_ID,
        secureCookie: false,
      }),
    };
  }

  it("authenticates confirmation claims and discards the bearer before persistence", async () => {
    const fixture = setup();
    const token = issue();
    const response = await fixture.handler(
      request("/api/newsletter/confirm", { token }, { "x-csrf-token": CSRF }),
    );

    expect(response.status).toBe(202);
    const text = await response.text();
    expect(JSON.parse(text)).toEqual({ code: "REQUEST_ACCEPTED" });
    expect(text).not.toContain(token);
    expect(fixture.abuseGuard.check).toHaveBeenCalledWith(
      expect.anything(),
      "public_newsletter_confirm",
    );
    expect(fixture.abuseGuard.check).toHaveBeenCalledWith(
      expect.anything(),
      "public_newsletter_confirm",
      { kind: "token", value: CLAIMS.tokenId, humanVerified: false },
    );
    expect(fixture.confirm).toHaveBeenCalledOnce();
    const persisted = fixture.confirm.mock.calls[0]![0];
    expect(persisted).toMatchObject({
      idempotencyKey: IDEMPOTENCY_KEY,
      claims: CLAIMS,
      signingKeyId: "primary_1",
      requestFingerprint: expect.any(Buffer),
      principalScopeHash: PRINCIPAL,
    });
    expect(JSON.stringify(persisted)).not.toContain(token);
    expect(response.headers.get("set-cookie")).toContain("Max-Age=0");
  });

  it("returns the same accepted response for an invalid token without database work", async () => {
    const fixture = setup();
    const response = await fixture.handler(
      request(
        "/api/newsletter/confirm",
        { token: "syntactically-private-but-invalid" },
        { "x-csrf-token": CSRF },
      ),
    );
    expect(response.status).toBe(202);
    expect(await json(response)).toEqual({ code: "REQUEST_ACCEPTED" });
    expect(fixture.confirm).not.toHaveBeenCalled();
  });

  it("silently contains a token-scoped rejection after authenticating claims", async () => {
    const fixture = setup();
    fixture.abuseGuard.check
      .mockResolvedValueOnce({
        ok: true,
        principalScopeHash: PRINCIPAL,
      })
      .mockResolvedValueOnce({
        ok: false,
        status: 429,
        code: "RATE_LIMITED",
        retryAfterSeconds: 90,
      });
    const response = await fixture.handler(
      request(
        "/api/newsletter/confirm",
        { token: issue() },
        { "x-csrf-token": CSRF },
      ),
    );

    expect(response.status).toBe(202);
    expect(await json(response)).toEqual({ code: "REQUEST_ACCEPTED" });
    expect(response.headers.get("retry-after")).toBeNull();
    expect(fixture.confirm).not.toHaveBeenCalled();
  });

  it("hard-codes unsubscribe purpose and method", async () => {
    const claims = {
      ...CLAIMS,
      purpose: "newsletter_unsubscribe" as const,
      expiresAt: "2026-07-20T10:00:00.000Z",
    };
    const selectedCodec = codec();
    const token = selectedCodec.issue({
      claims,
      signingKeyId: "primary_1",
      now: NOW,
    });
    const fixture = setup("unsubscribe", selectedCodec);
    const response = await fixture.handler(
      request(
        "/api/newsletter/unsubscribe",
        { token },
        { "x-csrf-token": CSRF },
      ),
    );
    expect(response.status).toBe(202);
    expect(fixture.unsubscribe).toHaveBeenCalledOnce();
    expect(fixture.confirm).not.toHaveBeenCalled();
    expect(fixture.abuseGuard.check).toHaveBeenCalledWith(
      expect.anything(),
      "public_newsletter_unsubscribe",
    );
  });

  it("rejects missing CSRF before abuse, token, or repository work", async () => {
    const selectedCodec = codec();
    const verify = vi.fn(selectedCodec.verify);
    const fixture = setup("confirm", {
      verify,
      issue: selectedCodec.issue,
    });
    const response = await fixture.handler(
      request("/api/newsletter/confirm", { token: issue() }),
    );
    expect(response.status).toBe(403);
    expect(fixture.abuseGuard.check).not.toHaveBeenCalled();
    expect(verify).not.toHaveBeenCalled();
    expect(fixture.confirm).not.toHaveBeenCalled();
  });
});

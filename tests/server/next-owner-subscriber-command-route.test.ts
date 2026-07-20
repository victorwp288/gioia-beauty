import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { requestFingerprint } from "@/lib/server/bookingSecurity.ts";
import type { OwnerSubscriberCommandRepository } from "@/lib/server/database/ownerSubscriberCommandRepository.ts";
import type { OwnerCommandResult } from "@/lib/server/database/ownerScheduleRepositorySupport.ts";
import {
  createNextOwnerSubscriberUnsubscribeRoute,
  type NextOwnerSubscriberCommandRouteDependencies,
} from "@/lib/server/nextOwnerSubscriberCommandRoute.ts";
import {
  now,
  secret,
  sessionId,
  setup,
  userId,
} from "./fresh-owner-session-fixture.ts";

const CSRF_TOKEN = "A".repeat(43);
const SUBSCRIBER_ID = "30000000-0000-4000-8000-000000000001";
const IDEMPOTENCY_KEY = "40000000-0000-4000-8000-000000000001";
const REQUEST_ID = "50000000-0000-4000-8000-000000000001";

function success(replayed = false): OwnerCommandResult {
  return {
    http_status: 200,
    result: { code: "SUBSCRIBER_UNSUBSCRIBED", resource_id: SUBSCRIBER_ID },
    replayed,
  };
}

function request(
  body: unknown = {
    subscriberId: SUBSCRIBER_ID.toUpperCase(),
    expectedVersion: 2,
  },
) {
  return new Request(
    "https://preview.example.test/api/admin/subscribers/unsubscribe",
    {
      method: "POST",
      headers: {
        host: "preview.example.test",
        origin: "https://preview.example.test",
        "content-type": "application/json",
        "idempotency-key": IDEMPOTENCY_KEY,
        "x-csrf-token": CSRF_TOKEN,
      },
      body: JSON.stringify(body),
    },
  );
}

function fixture(result: OwnerCommandResult = success()) {
  const authFixture = setup();
  const unsubscribeSubscriber = vi.fn(async () => result);
  const repository = {
    unsubscribeSubscriber,
  } satisfies OwnerSubscriberCommandRepository;
  const dependencies = {
    repository,
    writeGate: {
      check: vi.fn(async () => ({
        ok: true as const,
        canaryToken: null,
        mode: "open" as const,
      })),
    },
    readSecurityTokens: vi.fn(async () => ({
      bindingToken: authFixture.bindingToken,
      csrfToken: CSRF_TOKEN,
    })),
    createAuthContext: vi.fn(async () => ({
      auth: { ...authFixture.auth, signOut: vi.fn() } as never,
      responseHeaders: new Headers(),
      securityCookieStore: { get: vi.fn(), set: vi.fn() },
      secure: true,
    })),
    getBindingSecret: () => secret,
    createRequestId: () => REQUEST_ID,
    now,
  } satisfies NextOwnerSubscriberCommandRouteDependencies;
  return { dependencies, unsubscribeSubscriber };
}

describe("Next owner subscriber unsubscribe route", () => {
  it.each([false, true])(
    "returns the exact soft-unsubscribe result when replayed=%s",
    async (replayed) => {
      const route = fixture(success(replayed));
      const response = await createNextOwnerSubscriberUnsubscribeRoute(
        route.dependencies,
      )(request());

      expect(response.status).toBe(200);
      expect(await response.json()).toEqual({
        code: "SUBSCRIBER_UNSUBSCRIBED",
        resourceId: SUBSCRIBER_ID,
        replayed,
      });
      expect(route.unsubscribeSubscriber).toHaveBeenCalledWith(
        { userId, sessionId },
        {
          subscriberId: SUBSCRIBER_ID,
          expectedVersion: 2,
          idempotencyKey: IDEMPOTENCY_KEY,
        },
        requestFingerprint({
          operation: "owner_unsubscribe_subscriber",
          version: 1,
          request: { subscriberId: SUBSCRIBER_ID, expectedVersion: 2 },
        }),
        null,
      );
    },
  );

  it.each([
    [404, "SUBSCRIBER_NOT_FOUND"],
    [409, "VERSION_CONFLICT"],
    [409, "SUBSCRIBER_NOT_UNSUBSCRIBABLE"],
  ])("returns the exact %s %s failure", async (status, code) => {
    const route = fixture({
      http_status: status,
      result: { code },
      replayed: false,
    } as OwnerCommandResult);
    const response = await createNextOwnerSubscriberUnsubscribeRoute(
      route.dependencies,
    )(request());

    expect(response.status).toBe(status);
    expect(await response.json()).toEqual({ code, requestId: REQUEST_ID });
  });

  it.each([
    {},
    { subscriberId: "invalid", expectedVersion: 2 },
    { subscriberId: SUBSCRIBER_ID, expectedVersion: 0 },
    { subscriberId: SUBSCRIBER_ID, expectedVersion: 2, status: "unsubscribed" },
  ])("rejects invalid body %# before repository work", async (body) => {
    const route = fixture();
    const response = await createNextOwnerSubscriberUnsubscribeRoute(
      route.dependencies,
    )(request(body));

    expect(response.status).toBe(422);
    expect(await response.json()).toEqual({
      code: "INVALID_REQUEST",
      requestId: REQUEST_ID,
    });
    expect(route.unsubscribeSubscriber).not.toHaveBeenCalled();
  });
});

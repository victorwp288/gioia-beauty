import { Webhook } from "svix";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { createResendWebhookPostHandler } from "@/lib/server/email/resendWebhookHandler.ts";

const NOW = new Date("2035-02-05T10:00:00.000Z");
const REQUEST_ID = "10000000-0000-4000-8000-000000000001";
const SECRET = `whsec_${Buffer.alloc(32, 9).toString("base64")}`;
const BODY = JSON.stringify({
  type: "email.complained",
  created_at: NOW.toISOString(),
  data: {
    email_id: "msg_synthetic_1",
    to: ["private@example.test"],
    subject: "Private subject",
  },
});

function signedRequest(body = BODY, signatureBody = body) {
  const webhook = new Webhook(SECRET);
  const timestamp = String(Math.floor(NOW.getTime() / 1_000));
  return new Request("https://example.test/api/webhooks/resend", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "svix-id": "evt_synthetic_1",
      "svix-timestamp": timestamp,
      "svix-signature": webhook.sign("evt_synthetic_1", NOW, signatureBody),
    },
    body,
  });
}

function repository(result: {
  processingState: "processed" | "error";
  replayed: boolean;
  errorCode: string | null;
}) {
  return { processVerified: vi.fn(async () => result) };
}

function syntheticHandler(
  selectedRepository: ReturnType<typeof repository>,
  overrides: { env?: Readonly<Record<string, string | undefined>> } = {},
) {
  return createResendWebhookPostHandler({
    repository: selectedRepository,
    env: { RESEND_WEBHOOK_SECRET: SECRET },
    now: () => NOW,
    requestId: () => REQUEST_ID,
    allowSyntheticTestRuntime: true,
    ...overrides,
  });
}

afterEach(() => {
  vi.useRealTimers();
});

describe("Resend webhook HTTP boundary", () => {
  it("verifies, reduces, persists, and acknowledges only after commit", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(NOW);
    const store = repository({
      processingState: "processed",
      replayed: false,
      errorCode: null,
    });
    const response = await syntheticHandler(store)(signedRequest());

    expect(response.status).toBe(200);
    const responseBody = await response.json();
    expect(responseBody).toEqual({
      code: "REQUEST_ACCEPTED",
      requestId: REQUEST_ID,
      replayed: false,
    });
    expect(response.headers.get("x-request-id")).toBe(REQUEST_ID);
    expect(response.headers.get("cache-control")).toContain("no-store");
    expect(response.headers.get("content-security-policy")).toBe(
      "default-src 'none'; frame-ancestors 'none'",
    );
    expect(store.processVerified).toHaveBeenCalledOnce();
    expect(store.processVerified).toHaveBeenCalledWith({
      providerEventId: "evt_synthetic_1",
      signatureVerified: true,
      providerMessageId: "msg_synthetic_1",
      eventKind: "complained",
      payloadSha256: expect.stringMatching(/^[a-f0-9]{64}$/),
      receivedAt: NOW.toISOString(),
    });
    expect(JSON.stringify(responseBody)).not.toContain("private@example.test");
  });

  it("acknowledges an exact durable replay", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(NOW);
    const store = repository({
      processingState: "processed",
      replayed: true,
      errorCode: null,
    });
    const response = await syntheticHandler(store)(signedRequest());
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ replayed: true });
  });

  it("rejects invalid signatures before database work", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(NOW);
    const store = repository({
      processingState: "processed",
      replayed: false,
      errorCode: null,
    });
    const response = await syntheticHandler(store)(
      signedRequest(`${BODY} `, BODY),
    );
    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({
      code: "INVALID_WEBHOOK",
      requestId: REQUEST_ID,
    });
    expect(store.processVerified).not.toHaveBeenCalled();
  });

  it.each([
    ["PROVIDER_MESSAGE_NOT_FOUND", 503, "WEBHOOK_MESSAGE_PENDING"],
    ["MESSAGE_ID_REQUIRED", 400, "INVALID_WEBHOOK"],
  ] as const)(
    "maps durable %s to retry policy %i/%s",
    async (errorCode, status, code) => {
      vi.useFakeTimers();
      vi.setSystemTime(NOW);
      const store = repository({
        processingState: "error",
        replayed: false,
        errorCode,
      });
      const response = await syntheticHandler(store)(signedRequest());
      expect(response.status).toBe(status);
      expect(await response.json()).toEqual({ code, requestId: REQUEST_ID });
    },
  );

  it.each([
    ["PT409", "WEBHOOK_EVENT_ID_REUSED", 409, "WEBHOOK_EVENT_CONFLICT"],
    ["XX999", "private database detail", 503, "SERVICE_UNAVAILABLE"],
  ] as const)(
    "redacts database failure %s/%s",
    async (databaseCode, message, status, responseCode) => {
      vi.useFakeTimers();
      vi.setSystemTime(NOW);
      const store = repository({
        processingState: "processed",
        replayed: false,
        errorCode: null,
      });
      store.processVerified.mockRejectedValueOnce(
        Object.assign(new Error(message), { code: databaseCode }),
      );
      const response = await syntheticHandler(store)(signedRequest());
      expect(response.status).toBe(status);
      expect(await response.json()).toEqual({
        code: responseCode,
        requestId: REQUEST_ID,
      });
    },
  );

  it("keeps the live route disabled outside a validated Production runtime", async () => {
    const store = repository({
      processingState: "processed",
      replayed: false,
      errorCode: null,
    });
    const verifierFactory = vi.fn();
    const handler = createResendWebhookPostHandler({
      repository: store,
      env: {
        APP_ENV: "local",
        NEXT_PUBLIC_APP_ENV: "local",
        EMAIL_TRANSPORT: "fake",
        EMAIL_WEBHOOK_ENABLED: "false",
      },
      verifierFactory,
      requestId: () => REQUEST_ID,
    });
    const response = await handler(signedRequest());
    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({
      code: "SERVICE_UNAVAILABLE",
      requestId: REQUEST_ID,
    });
    expect(verifierFactory).not.toHaveBeenCalled();
    expect(store.processVerified).not.toHaveBeenCalled();
  });

  it("fails closed when the signing secret cannot configure a verifier", async () => {
    const store = repository({
      processingState: "processed",
      replayed: false,
      errorCode: null,
    });
    const handler = syntheticHandler(store, {
      env: { RESEND_WEBHOOK_SECRET: "not-a-secret" },
    });
    const response = await handler(signedRequest());
    expect(response.status).toBe(503);
    expect(store.processVerified).not.toHaveBeenCalled();
  });
});

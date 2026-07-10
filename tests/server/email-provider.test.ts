import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import {
  EmailProviderConfigurationError,
  createEmailProvider,
  createFakeEmailProvider,
  createResendEmailProvider,
  type EmailMessage,
  type FetchEmail,
} from "@/lib/server/email/emailProvider.ts";

const message: EmailMessage = {
  from: "Gioia Beauty <noreply@gioiabeauty.net>",
  to: ["client@example.test"],
  subject: "Messaggio sintetico",
  html: "<p>Contenuto sintetico</p>",
  text: "Contenuto sintetico",
};
const idempotencyKey =
  "schedule:10000000-0000-4000-8000-000000000001:v2:customer";
const apiKey = "re_synthetic_provider_key_123456789";

function response(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("fake email provider", () => {
  it("returns one deterministic identity without any network dependency", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    const provider = createFakeEmailProvider();

    const first = await provider.send(message, { idempotencyKey });
    const second = await provider.send(message, { idempotencyKey });

    expect(first).toEqual(second);
    expect(first).toEqual({
      ok: true,
      providerMessageId:
        "fake_0a9c2db777dae71316220512a7cbda30cdd67073860814d6f77048cc8ff07396",
    });
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("fails closed for malformed messages or keys", async () => {
    const provider = createFakeEmailProvider();
    await expect(
      provider.send({ ...message, to: [] }, { idempotencyKey }),
    ).resolves.toEqual({
      ok: false,
      errorCode: "PROVIDER_REQUEST_INVALID",
      retryable: false,
    });
  });
});

describe("Resend API provider", () => {
  it("sends the exact immutable payload and database idempotency key", async () => {
    const fetchEmail = vi.fn<FetchEmail>(async () =>
      response({ id: "provider-123" }),
    );
    const provider = createResendEmailProvider({ apiKey, fetchEmail });

    await expect(provider.send(message, { idempotencyKey })).resolves.toEqual({
      ok: true,
      providerMessageId: "provider-123",
    });

    expect(fetchEmail).toHaveBeenCalledOnce();
    const [url, init] = fetchEmail.mock.calls[0]!;
    expect(url).toBe("https://api.resend.com/emails");
    expect(init).toMatchObject({
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
        "Idempotency-Key": idempotencyKey,
        "User-Agent": "gioia-beauty-outbox/1.0",
      },
      body: JSON.stringify(message),
      signal: expect.any(AbortSignal),
    });
  });

  it.each([
    [408, {}, "PROVIDER_TIMEOUT", true],
    [429, {}, "PROVIDER_RATE_LIMITED", true],
    [500, {}, "PROVIDER_UNAVAILABLE", true],
    [503, {}, "PROVIDER_UNAVAILABLE", true],
    [401, {}, "PROVIDER_AUTH_INVALID", false],
    [403, {}, "PROVIDER_AUTH_INVALID", false],
    [422, {}, "PROVIDER_REQUEST_INVALID", false],
    [
      409,
      { name: "concurrent_idempotent_requests" },
      "PROVIDER_CONCURRENT_IDEMPOTENCY",
      true,
    ],
    [
      409,
      { name: "invalid_idempotent_request" },
      "PROVIDER_IDEMPOTENCY_CONFLICT",
      false,
    ],
  ] as const)(
    "classifies HTTP %i as %s",
    async (status, body, errorCode, retryable) => {
      const provider = createResendEmailProvider({
        apiKey,
        fetchEmail: vi.fn(async () => response(body, status)),
      });
      await expect(provider.send(message, { idempotencyKey })).resolves.toEqual(
        { ok: false, errorCode, retryable },
      );
    },
  );

  it("treats malformed or oversized success responses as retryable", async () => {
    const malformed = createResendEmailProvider({
      apiKey,
      fetchEmail: vi.fn(async () => response({ accepted: true })),
    });
    const oversized = createResendEmailProvider({
      apiKey,
      fetchEmail: vi.fn(async () => response({ id: "x".repeat(20_000) })),
    });

    for (const provider of [malformed, oversized]) {
      await expect(provider.send(message, { idempotencyKey })).resolves.toEqual(
        {
          ok: false,
          errorCode: "PROVIDER_RESPONSE_INVALID",
          retryable: true,
        },
      );
    }
  });

  it("maps network failures and bounded aborts without exposing raw errors", async () => {
    const network = createResendEmailProvider({
      apiKey,
      fetchEmail: vi.fn(async () => {
        throw new Error("client@example.test provider secret response");
      }),
    });
    const timeout = createResendEmailProvider({
      apiKey,
      timeoutMs: 100,
      fetchEmail: vi.fn<FetchEmail>(
        (_url, init) =>
          new Promise<Pick<Response, "body" | "ok" | "status">>(
            (_resolve, reject) => {
              init.signal?.addEventListener("abort", () => {
                reject(new DOMException("synthetic", "AbortError"));
              });
            },
          ),
      ),
    });

    await expect(network.send(message, { idempotencyKey })).resolves.toEqual({
      ok: false,
      errorCode: "PROVIDER_NETWORK_ERROR",
      retryable: true,
    });
    await expect(timeout.send(message, { idempotencyKey })).resolves.toEqual({
      ok: false,
      errorCode: "PROVIDER_TIMEOUT",
      retryable: true,
    });
  });

  it("rejects missing credentials and unknown transports before delivery", () => {
    expect(() =>
      createResendEmailProvider({ apiKey: "synthetic-invalid" }),
    ).toThrow(EmailProviderConfigurationError);
    expect(() => createEmailProvider({ EMAIL_TRANSPORT: "disabled" })).toThrow(
      EmailProviderConfigurationError,
    );
    expect(() =>
      createEmailProvider({
        EMAIL_TRANSPORT: "resend",
        RESEND_API_KEY: apiKey,
      }),
    ).toThrow(EmailProviderConfigurationError);
  });
});

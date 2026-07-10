import { createHash } from "node:crypto";

import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { verifyResendWebhookRequest } from "@/lib/server/email/resendWebhookRequest.ts";
import type { ResendWebhookVerifier } from "@/lib/server/email/resendWebhookVerifier.ts";

const NOW = new Date("2035-02-05T10:00:00.000Z");
const TIMESTAMP = String(Math.floor(NOW.getTime() / 1_000));
const VALID_HEADERS = {
  "content-type": "application/json; charset=utf-8",
  "svix-id": "evt_synthetic_0001",
  "svix-timestamp": TIMESTAMP,
  "svix-signature": "v1,c3ludGhldGljLXNpZ25hdHVyZQ==",
};

function request(
  body: BodyInit = "{}",
  headers: Record<string, string | undefined> = {},
  url = "https://example.test/api/webhooks/resend",
) {
  const merged = new Headers(VALID_HEADERS);
  for (const [name, value] of Object.entries(headers)) {
    if (value === undefined) merged.delete(name);
    else merged.set(name, value);
  }
  return new Request(url, { method: "POST", headers: merged, body });
}

function verifier(payload: unknown) {
  return {
    verify: vi.fn(() => payload),
  } satisfies ResendWebhookVerifier;
}

describe("bounded verified Resend webhook request", () => {
  it("preserves exact raw bytes, maps delivery, and hashes no PII fields", async () => {
    const body =
      '{\n  "type":"email.bounced",\n  "data":{"email_id":"msg_1","to":["private@example.test"],"subject":"Private"}\n}';
    const verify = verifier({
      type: "email.bounced",
      data: {
        email_id: "msg_1",
        to: ["private@example.test"],
        subject: "Private",
      },
    });

    await expect(
      verifyResendWebhookRequest({
        request: request(body),
        verifier: verify,
        now: () => NOW,
      }),
    ).resolves.toEqual({
      ok: true,
      event: {
        providerEventId: "evt_synthetic_0001",
        signatureVerified: true,
        providerMessageId: "msg_1",
        eventKind: "bounced",
        payloadSha256: createHash("sha256").update(body).digest("hex"),
        receivedAt: NOW.toISOString(),
      },
    });

    expect(verify.verify).toHaveBeenCalledWith(Buffer.from(body), {
      "svix-id": "evt_synthetic_0001",
      "svix-timestamp": TIMESTAMP,
      "svix-signature": VALID_HEADERS["svix-signature"],
    });
  });

  it.each([
    ["email.delivered", "delivered"],
    ["email.bounced", "bounced"],
    ["email.complained", "complained"],
  ] as const)("maps signed %s to %s", async (type, eventKind) => {
    const result = await verifyResendWebhookRequest({
      request: request("{}"),
      verifier: verifier({ type, data: { email_id: "msg_1" } }),
      now: () => NOW,
    });

    expect(result).toMatchObject({
      ok: true,
      event: { eventKind, providerMessageId: "msg_1" },
    });
  });

  it.each(["email.failed", "email.suppressed", "domain.updated"])(
    "reduces signed unsupported type %s to other without a message identity",
    async (type) => {
      const result = await verifyResendWebhookRequest({
        request: request("{}"),
        verifier: verifier({
          type,
          data: { email_id: "msg_must_be_discarded", subject: "Private" },
        }),
        now: () => NOW,
      });
      expect(result).toMatchObject({
        ok: true,
        event: { eventKind: "other", providerMessageId: null },
      });
    },
  );

  it("rejects a signed known event without an exact provider message ID", async () => {
    const result = await verifyResendWebhookRequest({
      request: request("{}"),
      verifier: verifier({
        type: "email.delivered",
        data: { email_id: " msg_changed_by_normalization " },
      }),
      now: () => NOW,
    });
    expect(result).toEqual({
      ok: false,
      status: 400,
      code: "INVALID_WEBHOOK",
    });
  });

  it.each([
    [
      "wrong media type",
      { "content-type": "text/plain" },
      415,
      "UNSUPPORTED_MEDIA_TYPE",
    ],
    [
      "compressed body",
      { "content-encoding": "gzip" },
      415,
      "UNSUPPORTED_MEDIA_TYPE",
    ],
    ["malformed length", { "content-length": "32x" }, 400, "INVALID_WEBHOOK"],
    [
      "oversized declared length",
      { "content-length": "32769" },
      413,
      "PAYLOAD_TOO_LARGE",
    ],
    ["missing event ID", { "svix-id": undefined }, 400, "INVALID_WEBHOOK"],
    [
      "malformed signature",
      { "svix-signature": "v1,%%%" },
      400,
      "INVALID_WEBHOOK",
    ],
  ] as const)(
    "rejects %s before verification",
    async (_label, headers, status, code) => {
      const verify = verifier({ type: "email.delivered", data: {} });
      const result = await verifyResendWebhookRequest({
        request: request("{}", headers),
        verifier: verify,
        now: () => NOW,
      });
      expect(result).toEqual({ ok: false, status, code });
      expect(verify.verify).not.toHaveBeenCalled();
    },
  );

  it("rejects query parameters and a streamed body beyond 32 KiB", async () => {
    const verify = verifier({ type: "email.delivered", data: {} });
    await expect(
      verifyResendWebhookRequest({
        request: request(
          "{}",
          {},
          "https://example.test/api/webhooks/resend?batch=2",
        ),
        verifier: verify,
        now: () => NOW,
      }),
    ).resolves.toMatchObject({ status: 400, code: "INVALID_WEBHOOK" });
    await expect(
      verifyResendWebhookRequest({
        request: request("x".repeat(32 * 1_024 + 1)),
        verifier: verify,
        now: () => NOW,
      }),
    ).resolves.toMatchObject({ status: 413, code: "PAYLOAD_TOO_LARGE" });
    expect(verify.verify).not.toHaveBeenCalled();
  });

  it("accepts exactly 32 KiB and rejects provider IDs above 255 characters", async () => {
    const json = '{"type":"domain.updated","data":{}}';
    const exactBody = json + " ".repeat(32 * 1_024 - json.length);
    await expect(
      verifyResendWebhookRequest({
        request: request(exactBody),
        verifier: verifier({ type: "domain.updated", data: {} }),
        now: () => NOW,
      }),
    ).resolves.toMatchObject({ ok: true, event: { eventKind: "other" } });

    for (const [length, ok] of [
      [255, true],
      [256, false],
    ] as const) {
      const result = await verifyResendWebhookRequest({
        request: request("{}"),
        verifier: verifier({
          type: "email.delivered",
          data: { email_id: "m".repeat(length) },
        }),
        now: () => NOW,
      });
      expect(result.ok).toBe(ok);
    }
  });

  it.each([
    [-300, true],
    [300, true],
    [-301, false],
    [301, false],
  ] as const)(
    "enforces the explicit timestamp boundary at offset %i seconds",
    async (offsetSeconds, ok) => {
      const timestamp = String(
        Math.floor(NOW.getTime() / 1_000) + offsetSeconds,
      );
      const result = await verifyResendWebhookRequest({
        request: request("{}", { "svix-timestamp": timestamp }),
        verifier: verifier({ type: "domain.updated", data: {} }),
        now: () => NOW,
      });
      expect(result.ok).toBe(ok);
    },
  );

  it("rejects invalid UTF-8, verifier failure, and explicit stale timestamps", async () => {
    const throwing = {
      verify: vi.fn(() => {
        throw new Error("private");
      }),
    };
    const accepted = verifier({ type: "email.delivered", data: {} });

    for (const [webhookRequest, selectedVerifier] of [
      [request(new Uint8Array([0xff])), accepted],
      [request("{}"), throwing],
      [request("{}", { "svix-timestamp": "2054282099" }), accepted],
    ] as const) {
      await expect(
        verifyResendWebhookRequest({
          request: webhookRequest,
          verifier: selectedVerifier,
          now: () => NOW,
        }),
      ).resolves.toEqual({
        ok: false,
        status: 400,
        code: "INVALID_WEBHOOK",
      });
    }
  });
});

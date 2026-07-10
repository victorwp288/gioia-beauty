import { Webhook } from "svix";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import {
  ResendWebhookConfigurationError,
  createResendWebhookVerifier,
} from "@/lib/server/email/resendWebhookVerifier.ts";

const NOW = new Date("2035-02-05T10:00:00.000Z");
const SECRET = `whsec_${Buffer.alloc(32, 7).toString("base64")}`;
const BODY = '{"type":"email.delivered","data":{"email_id":"msg_1"}}';

afterEach(() => {
  vi.useRealTimers();
});

describe("Resend Svix verifier", () => {
  it("verifies one exact raw-body signature with the pinned implementation", () => {
    vi.useFakeTimers();
    vi.setSystemTime(NOW);
    const signature = new Webhook(SECRET).sign("evt_1", NOW, BODY);
    const verifier = createResendWebhookVerifier(SECRET);

    expect(
      verifier.verify(Buffer.from(BODY), {
        "svix-id": "evt_1",
        "svix-timestamp": String(Math.floor(NOW.getTime() / 1_000)),
        "svix-signature": signature,
      }),
    ).toEqual({ type: "email.delivered", data: { email_id: "msg_1" } });
  });

  it("rejects payload drift and stale signed timestamps", () => {
    vi.useFakeTimers();
    vi.setSystemTime(NOW);
    const old = new Date(NOW.getTime() - 301_000);
    const webhook = new Webhook(SECRET);
    const verifier = createResendWebhookVerifier(SECRET);

    expect(() =>
      verifier.verify(Buffer.from(`${BODY} `), {
        "svix-id": "evt_1",
        "svix-timestamp": String(Math.floor(NOW.getTime() / 1_000)),
        "svix-signature": webhook.sign("evt_1", NOW, BODY),
      }),
    ).toThrow();
    expect(() =>
      verifier.verify(Buffer.from(BODY), {
        "svix-id": "evt_old",
        "svix-timestamp": String(Math.floor(old.getTime() / 1_000)),
        "svix-signature": webhook.sign("evt_old", old, BODY),
      }),
    ).toThrow();
  });

  it("accepts a matching signature among multiple versioned candidates", () => {
    vi.useFakeTimers();
    vi.setSystemTime(NOW);
    const webhook = new Webhook(SECRET);
    const valid = webhook.sign("evt_multi", NOW, BODY);
    const invalid = `v1,${Buffer.alloc(32).toString("base64")}`;

    expect(
      createResendWebhookVerifier(SECRET).verify(Buffer.from(BODY), {
        "svix-id": "evt_multi",
        "svix-timestamp": String(Math.floor(NOW.getTime() / 1_000)),
        "svix-signature": `${invalid} ${valid}`,
      }),
    ).toMatchObject({ type: "email.delivered" });
  });

  it.each([undefined, "", " synthetic", "whsec_too-short"])(
    "fails closed for malformed secret %s",
    (secret) => {
      expect(() => createResendWebhookVerifier(secret)).toThrow(
        ResendWebhookConfigurationError,
      );
    },
  );
});

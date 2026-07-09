import { afterEach, describe, expect, it, vi } from "vitest";

import { deliverEmail } from "@/lib/server/resend";

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("server email transport", () => {
  it("captures a fake outcome without constructing a provider client", async () => {
    vi.stubEnv("EMAIL_TRANSPORT", "fake");
    vi.stubEnv("RESEND_API_KEY", "");

    await expect(deliverEmail({ synthetic: true })).resolves.toMatchObject({
      messageId: expect.stringMatching(/^fake_[0-9a-f-]{36}$/),
      transport: "fake",
    });
  });

  it("fails closed when no recognized transport is selected", async () => {
    vi.stubEnv("EMAIL_TRANSPORT", "disabled");

    await expect(deliverEmail({ synthetic: true })).rejects.toMatchObject({
      code: "email_transport_disabled",
    });
  });
});

import { describe, expect, it, vi } from "vitest";

import {
  deliveryFailed,
  sendBookingEmailRequest,
  sendCancellationEmailRequest,
} from "@/lib/client/emailDelivery";

describe("email delivery client", () => {
  it("returns explicit partial-delivery state without retrying a POST", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          success: false,
          delivery: {
            customer: { status: "failed", code: "provider_rejected" },
            admin: { status: "sent" },
          },
        }),
        { status: 207, headers: { "content-type": "application/json" } },
      ),
    );

    const result = await sendBookingEmailRequest(
      { synthetic: true },
      { fetchImpl },
    );

    expect(result.success).toBe(false);
    expect(deliveryFailed(result, "customer")).toBe(true);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it("adds the owner bearer token to cancellation requests", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          success: true,
          delivery: { customer: { status: "sent" } },
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      ),
    );

    await sendCancellationEmailRequest(
      { synthetic: true },
      { idToken: "synthetic-token", fetchImpl },
    );

    expect(fetchImpl.mock.calls[0][1].headers.Authorization).toBe(
      "Bearer synthetic-token",
    );
  });

  it("maps network failures to a stable non-PII result", async () => {
    const result = await sendBookingEmailRequest(
      { synthetic: true },
      { fetchImpl: vi.fn().mockRejectedValue(new Error("offline")) },
    );

    expect(result).toEqual({
      success: false,
      status: 0,
      error: "network_error",
      delivery: null,
    });
  });
});

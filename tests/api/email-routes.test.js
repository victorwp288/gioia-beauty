import { describe, expect, it, vi } from "vitest";

import { createCancellationEmailPostHandler } from "@/app/api/cancel/route";
import { createBookingEmailPostHandler } from "@/app/api/send/route";

const bookingBody = {
  email: "cliente@example.com",
  name: "Cliente Test",
  startTime: "10:00",
  endTime: "11:00",
  duration: 60,
  date: "10/07/2026",
  appointmentType: "Manicure",
};

const allowedLimiter = {
  check: () => ({ allowed: true, remaining: 4, resetAt: Date.now() + 60_000 }),
};

function postRequest(path, body, headers = {}) {
  return new Request(`https://www.gioiabeauty.net${path}`, {
    method: "POST",
    headers: { "content-type": "application/json", ...headers },
    body: typeof body === "string" ? body : JSON.stringify(body),
  });
}

describe("POST /api/send", () => {
  it("rejects invalid non-empty customer email before delivery", async () => {
    const deliver = vi.fn();
    const handler = createBookingEmailPostHandler({
      authorize: async () => ({ ok: true, userId: "owner" }),
      deliver,
      limiter: allowedLimiter,
    });

    const response = await handler(
      postRequest("/api/send", { ...bookingBody, email: "not-an-email" }),
    );

    expect(response.status).toBe(422);
    expect(deliver).not.toHaveBeenCalled();
  });

  it("requires owner authentication even when a customer email is present", async () => {
    const deliver = vi.fn();
    const handler = createBookingEmailPostHandler({
      authorize: async () => ({
        ok: false,
        status: 401,
        code: "authentication_required",
      }),
      deliver,
      limiter: allowedLimiter,
    });
    const response = await handler(postRequest("/api/send", bookingBody));

    expect(response.status).toBe(401);
    expect(deliver).not.toHaveBeenCalled();
  });

  it("treats an absent customer email as intentional and still sends admin mail", async () => {
    const deliver = vi.fn().mockResolvedValue({ messageId: "admin-message" });
    const handler = createBookingEmailPostHandler({
      authorize: async () => ({ ok: true, userId: "owner" }),
      deliver,
      limiter: allowedLimiter,
      adminEmail: "admin@example.com",
    });

    const { email: _email, ...withoutEmail } = bookingBody;
    const response = await handler(postRequest("/api/send", withoutEmail));
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(payload.delivery.customer).toEqual({
      status: "skipped",
      reason: "no_recipient",
    });
    expect(payload.delivery.admin).toEqual({ status: "sent" });
    expect(deliver).toHaveBeenCalledTimes(1);
    expect(deliver.mock.calls[0][0].to).toEqual(["admin@example.com"]);
  });

  it("attempts admin delivery even when customer delivery fails", async () => {
    const deliver = vi
      .fn()
      .mockRejectedValueOnce(
        Object.assign(new Error("rejected"), { code: "422" }),
      )
      .mockResolvedValueOnce({ messageId: "admin-message" });
    const handler = createBookingEmailPostHandler({
      authorize: async () => ({ ok: true, userId: "owner" }),
      deliver,
      limiter: allowedLimiter,
    });

    const response = await handler(postRequest("/api/send", bookingBody));
    const payload = await response.json();

    expect(response.status).toBe(207);
    expect(deliver).toHaveBeenCalledTimes(2);
    expect(payload.delivery.customer).toEqual({
      status: "failed",
      code: "422",
    });
    expect(payload.delivery.admin).toEqual({ status: "sent" });
  });

  it("rejects cross-origin browser requests", async () => {
    const deliver = vi.fn();
    const handler = createBookingEmailPostHandler({
      authorize: async () => ({ ok: true, userId: "owner" }),
      deliver,
      limiter: allowedLimiter,
    });

    const response = await handler(
      postRequest("/api/send", bookingBody, {
        origin: "https://attacker.test",
      }),
    );

    expect(response.status).toBe(403);
    expect(deliver).not.toHaveBeenCalled();
  });

  it("returns 429 without parsing or delivering when rate-limited", async () => {
    const deliver = vi.fn();
    const handler = createBookingEmailPostHandler({
      authorize: async () => ({ ok: true, userId: "owner" }),
      deliver,
      limiter: {
        check: () => ({
          allowed: false,
          remaining: 0,
          resetAt: Date.now() + 5_000,
        }),
      },
    });

    const response = await handler(postRequest("/api/send", bookingBody));

    expect(response.status).toBe(429);
    expect(response.headers.get("retry-after")).toBeTruthy();
    expect(deliver).not.toHaveBeenCalled();
  });

  it("rejects malformed JSON and oversized bodies before delivery", async () => {
    const deliver = vi.fn();
    const handler = createBookingEmailPostHandler({
      authorize: async () => ({ ok: true, userId: "owner" }),
      deliver,
      limiter: allowedLimiter,
    });

    const malformed = await handler(postRequest("/api/send", "{not-json"));
    const oversized = await handler(
      postRequest("/api/send", JSON.stringify({ padding: "x".repeat(9_000) })),
    );

    expect(malformed.status).toBe(400);
    expect(oversized.status).toBe(413);
    expect(deliver).not.toHaveBeenCalled();
  });

  it("returns only redacted recipient outcomes when the provider is unavailable", async () => {
    const deliver = vi.fn().mockRejectedValue(
      Object.assign(new Error("secret provider detail"), {
        code: "email_not_configured",
      }),
    );
    const handler = createBookingEmailPostHandler({
      authorize: async () => ({ ok: true, userId: "owner" }),
      deliver,
      limiter: allowedLimiter,
    });

    const response = await handler(postRequest("/api/send", bookingBody));
    const payload = await response.json();

    expect(response.status).toBe(502);
    expect(deliver).toHaveBeenCalledTimes(2);
    expect(payload).toEqual({
      success: false,
      delivery: {
        customer: { status: "failed", code: "email_not_configured" },
        admin: { status: "failed", code: "email_not_configured" },
      },
    });
    expect(JSON.stringify(payload)).not.toContain("secret provider detail");
  });

  it("does not reflect an unsafe provider error code", async () => {
    const deliver = vi.fn().mockRejectedValue(
      Object.assign(new Error("rejected"), {
        code: "victim@example.test\nprovider detail",
      }),
    );
    const handler = createBookingEmailPostHandler({
      authorize: async () => ({ ok: true, userId: "owner" }),
      deliver,
      limiter: allowedLimiter,
    });

    const response = await handler(postRequest("/api/send", bookingBody));
    const payload = await response.json();

    expect(response.status).toBe(502);
    expect(payload.delivery.customer.code).toBe("delivery_failed");
    expect(JSON.stringify(payload)).not.toContain("victim@example.test");
  });
});

describe("POST /api/cancel", () => {
  it("fails closed when owner authentication is missing", async () => {
    const deliver = vi.fn();
    const handler = createCancellationEmailPostHandler({
      authorize: async () => ({
        ok: false,
        status: 401,
        code: "authentication_required",
      }),
      deliver,
      limiter: allowedLimiter,
    });

    const response = await handler(postRequest("/api/cancel", bookingBody));

    expect(response.status).toBe(401);
    expect(deliver).not.toHaveBeenCalled();
  });

  it("sends one bounded cancellation message for an authorized owner", async () => {
    const deliver = vi.fn().mockResolvedValue({ messageId: "cancel-message" });
    const handler = createCancellationEmailPostHandler({
      authorize: async () => ({ ok: true, userId: "owner" }),
      deliver,
      limiter: allowedLimiter,
    });
    const { appointmentType: _appointmentType, ...cancellationBody } =
      bookingBody;

    const response = await handler(
      postRequest("/api/cancel", cancellationBody, {
        authorization: "Bearer synthetic-test-token",
      }),
    );
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(payload.delivery.customer).toEqual({ status: "sent" });
    expect(deliver).toHaveBeenCalledTimes(1);
  });

  it("rejects an invalid cancellation recipient after authorization", async () => {
    const deliver = vi.fn();
    const handler = createCancellationEmailPostHandler({
      authorize: async () => ({ ok: true, userId: "owner" }),
      deliver,
      limiter: allowedLimiter,
    });
    const { appointmentType: _appointmentType, ...cancellationBody } =
      bookingBody;

    const response = await handler(
      postRequest("/api/cancel", {
        ...cancellationBody,
        email: "invalid",
      }),
    );

    expect(response.status).toBe(422);
    expect(deliver).not.toHaveBeenCalled();
  });
});

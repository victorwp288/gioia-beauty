import { describe, expect, it, vi } from "vitest";

import {
  allowedLimiter,
  postRequest,
  routeCases,
} from "./legacy-email-fixture.js";

describe("legacy mail target and authorization order", () => {
  it.each(routeCases)(
    "rejects a $label query before limiter, Auth, body, or delivery",
    async ({ path, body, create }) => {
      const check = vi.fn();
      const authorize = vi.fn();
      const deliver = vi.fn();
      const handler = create({ authorize, deliver, limiter: { check } });
      const request = postRequest(`${path}?unexpected=1`, body);
      const getReader = vi.spyOn(request.body, "getReader");

      const response = await handler(request);

      expect(response.status).toBe(400);
      expect(await response.json()).toEqual({ error: "invalid_request" });
      expect(check).not.toHaveBeenCalled();
      expect(authorize).not.toHaveBeenCalled();
      expect(getReader).not.toHaveBeenCalled();
      expect(deliver).not.toHaveBeenCalled();
    },
  );

  it.each(routeCases)(
    "rejects every noncanonical $label Origin before a competing query",
    async ({ path, body, create }) => {
      for (const origin of [
        "",
        "https://attacker.test",
        "https://www.gioiabeauty.net/path",
        `https://${"a".repeat(500)}.test`,
      ]) {
        const check = vi.fn();
        const authorize = vi.fn();
        const deliver = vi.fn();
        const handler = create({ authorize, deliver, limiter: { check } });
        const request = postRequest(`${path}?unexpected=1`, body, { origin });
        const getReader = vi.spyOn(request.body, "getReader");

        expect((await handler(request)).status).toBe(403);
        expect(check).not.toHaveBeenCalled();
        expect(authorize).not.toHaveBeenCalled();
        expect(getReader).not.toHaveBeenCalled();
        expect(deliver).not.toHaveBeenCalled();
      }
    },
  );

  it.each(routeCases)(
    "keeps limiter → Auth → bounded body → $label delivery order",
    async ({ path, body, create, deliveries }) => {
      const events = [];
      const handler = create({
        limiter: {
          check: () => {
            events.push("limiter");
            return {
              allowed: true,
              remaining: 1,
              resetAt: Date.now() + 60_000,
            };
          },
        },
        authorize: async () => {
          events.push("authorize");
          return { ok: true, userId: "owner" };
        },
        deliver: async () => {
          events.push("deliver");
          return { messageId: "synthetic" };
        },
      });
      const request = postRequest(path, body);
      const originalGetReader = request.body.getReader.bind(request.body);
      vi.spyOn(request.body, "getReader").mockImplementation(() => {
        events.push("body");
        return originalGetReader();
      });

      const response = await handler(request);

      expect(response.status).toBe(200);
      expect(events).toEqual([
        "limiter",
        "authorize",
        "body",
        ...Array(deliveries).fill("deliver"),
      ]);
      expect(response.headers.get("x-content-type-options")).toBe("nosniff");
      expect(response.headers.get("content-security-policy")).toBe(
        "default-src 'none'; frame-ancestors 'none'",
      );
    },
  );

  it.each(routeCases)(
    "rate-limits $label before Auth or body",
    async ({ path, body, create }) => {
      const authorize = vi.fn();
      const deliver = vi.fn();
      const handler = create({
        authorize,
        deliver,
        limiter: {
          check: () => ({
            allowed: false,
            remaining: 0,
            resetAt: Date.now() + 5_000,
          }),
        },
      });
      const request = postRequest(path, body);
      const getReader = vi.spyOn(request.body, "getReader");

      expect((await handler(request)).status).toBe(429);
      expect(authorize).not.toHaveBeenCalled();
      expect(getReader).not.toHaveBeenCalled();
      expect(deliver).not.toHaveBeenCalled();
    },
  );

  it.each(routeCases)(
    "rejects unauthorized $label before reading the body",
    async ({ path, body, create }) => {
      const deliver = vi.fn();
      const handler = create({
        authorize: async () => ({
          ok: false,
          status: 401,
          code: "authentication_required",
        }),
        deliver,
        limiter: allowedLimiter(),
      });
      const request = postRequest(path, body);
      const getReader = vi.spyOn(request.body, "getReader");

      expect((await handler(request)).status).toBe(401);
      expect(getReader).not.toHaveBeenCalled();
      expect(deliver).not.toHaveBeenCalled();
    },
  );
});

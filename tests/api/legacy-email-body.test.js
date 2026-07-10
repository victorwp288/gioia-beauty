import { describe, expect, it, vi } from "vitest";

import {
  allowedLimiter,
  postRequest,
  routeCases,
} from "./legacy-email-fixture.js";

describe("legacy mail body integration", () => {
  const framingCases = [
    [{ "content-type": "" }, 415, "unsupported_media_type"],
    [{ "content-type": "text/plain" }, 415, "unsupported_media_type"],
    [{ "content-type": "application/jsonp" }, 415, "unsupported_media_type"],
    [
      { "content-type": "application/json; charset=iso-8859-1" },
      415,
      "unsupported_media_type",
    ],
    [
      { "content-type": `application/json;${"x".repeat(65)}` },
      415,
      "unsupported_media_type",
    ],
    [{ "content-encoding": "gzip" }, 415, "unsupported_media_type"],
    [{ "content-encoding": "identity,gzip" }, 415, "unsupported_media_type"],
    [{ "content-encoding": "x".repeat(65) }, 415, "unsupported_media_type"],
    [{ "content-length": "-1" }, 400, "invalid_request"],
    [{ "content-length": "01" }, 400, "invalid_request"],
    [{ "content-length": "8192,8192" }, 400, "invalid_request"],
    [{ "content-length": "1".repeat(33) }, 400, "invalid_request"],
    [{ "content-length": "9007199254740992" }, 400, "invalid_request"],
    [{ "content-length": "8193" }, 413, "payload_too_large"],
  ];

  it.each(routeCases)(
    "rejects $label framing after Auth but before body/delivery",
    async ({ path, body, create }) => {
      for (const [headers, status, error] of framingCases) {
        const authorize = vi.fn(async () => ({ ok: true, userId: "owner" }));
        const deliver = vi.fn();
        const handler = create({
          authorize,
          deliver,
          limiter: allowedLimiter(),
        });
        const request = postRequest(path, body, headers);
        const getReader = vi.spyOn(request.body, "getReader");
        const response = await handler(request);

        expect(response.status).toBe(status);
        expect(await response.json()).toEqual({ error });
        expect(authorize).toHaveBeenCalledOnce();
        expect(getReader).not.toHaveBeenCalled();
        expect(deliver).not.toHaveBeenCalled();
      }
    },
  );

  it.each(routeCases)(
    "accepts an exact 8192-byte $label body",
    async ({ path, body, create, deliveries }) => {
      const json = JSON.stringify(body);
      const exact = json + " ".repeat(8 * 1024 - Buffer.byteLength(json));
      const deliver = vi.fn(async () => ({ messageId: "synthetic" }));
      const handler = create({
        authorize: async () => ({ ok: true, userId: "owner" }),
        deliver,
        limiter: allowedLimiter(),
      });

      expect((await handler(postRequest(path, exact))).status).toBe(200);
      expect(deliver).toHaveBeenCalledTimes(deliveries);
    },
  );

  it.each(routeCases)(
    "cancels a streamed $label body at byte 8193",
    async ({ path, create }) => {
      const cancel = vi.fn();
      const stream = new ReadableStream({
        start(controller) {
          controller.enqueue(new TextEncoder().encode("x".repeat(8 * 1024)));
          controller.enqueue(new Uint8Array([0x78]));
        },
        cancel,
      });
      const authorize = vi.fn(async () => ({ ok: true, userId: "owner" }));
      const deliver = vi.fn();
      const handler = create({
        authorize,
        deliver,
        limiter: allowedLimiter(),
      });

      const response = await handler(postRequest(path, stream));

      expect(response.status).toBe(413);
      expect(await response.json()).toEqual({ error: "payload_too_large" });
      expect(authorize).toHaveBeenCalledOnce();
      expect(cancel).toHaveBeenCalledOnce();
      expect(deliver).not.toHaveBeenCalled();
    },
  );

  it.each(routeCases)(
    "redacts invalid UTF-8 and schema issue names for $label",
    async ({ path, body, create }) => {
      const authorize = vi.fn(async () => ({ ok: true, userId: "owner" }));
      const deliver = vi.fn();
      const handler = create({
        authorize,
        deliver,
        limiter: allowedLimiter(),
      });
      const invalidUtf8 = new Uint8Array(Buffer.from(JSON.stringify(body)));
      const nameOffset = Buffer.from(invalidUtf8).indexOf(body.name);
      invalidUtf8[nameOffset] = 0xff;

      const invalidResponse = await handler(postRequest(path, invalidUtf8));
      const reflected = "cliente@example.test";
      const schemaResponse = await handler(
        postRequest(path, { ...body, [reflected]: true }),
      );
      const schemaText = await schemaResponse.text();

      expect(invalidResponse.status).toBe(400);
      expect(await invalidResponse.json()).toEqual({ error: "invalid_json" });
      expect(schemaResponse.status).toBe(422);
      expect(JSON.parse(schemaText)).toEqual({ error: "invalid_request" });
      expect(schemaText).not.toContain(reflected);
      expect(authorize).toHaveBeenCalledTimes(2);
      expect(deliver).not.toHaveBeenCalled();
    },
  );
});

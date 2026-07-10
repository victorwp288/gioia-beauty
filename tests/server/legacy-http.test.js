import { z } from "zod";
import { describe, expect, it, vi } from "vitest";

import {
  MAX_EMAIL_REQUEST_BYTES,
  getClientAddress,
  hasNoQueryParameters,
  isSameOriginRequest,
  jsonResponse,
  readValidatedJson,
} from "@/lib/server/http";

const BodySchema = z.object({ value: z.string().min(1).max(100) }).strict();

function request(
  body = JSON.stringify({ value: "ok" }),
  headers = {},
  url = "https://www.gioiabeauty.net/api/send",
) {
  return new Request(url, {
    method: "POST",
    headers: { "content-type": "application/json", ...headers },
    body,
    ...(body instanceof ReadableStream ? { duplex: "half" } : {}),
  });
}

describe("legacy HTTP request target", () => {
  it("accepts only absent or canonical same-origin Origin", () => {
    expect(isSameOriginRequest(request())).toBe(true);
    expect(
      isSameOriginRequest(
        request(undefined, { origin: "https://www.gioiabeauty.net" }),
      ),
    ).toBe(true);

    for (const origin of [
      "",
      "https://attacker.test",
      "https://www.gioiabeauty.net/path",
      `https://${"a".repeat(500)}.test`,
    ]) {
      expect(isSameOriginRequest(request(undefined, { origin }))).toBe(false);
    }
  });

  it("accepts only an empty query string", () => {
    expect(hasNoQueryParameters(request())).toBe(true);
    expect(
      hasNoQueryParameters(
        request(
          undefined,
          {},
          "https://www.gioiabeauty.net/api/send?source=legacy",
        ),
      ),
    ).toBe(false);
  });

  it("bounds proxy address headers before deriving a limiter key", () => {
    expect(
      getClientAddress(
        request(undefined, { "x-forwarded-for": "192.0.2.1, 192.0.2.2" }),
      ),
    ).toBe("192.0.2.1");
    expect(
      getClientAddress(
        request(undefined, { "x-forwarded-for": "x".repeat(513) }),
      ),
    ).toBe("unknown");
  });
});

describe("legacy bounded JSON reader", () => {
  it("accepts canonical UTF-8 JSON and identity encoding", async () => {
    const result = await readValidatedJson(
      request(undefined, {
        "content-type": "Application/JSON;charset=UTF-8",
        "content-encoding": "Identity",
      }),
      BodySchema,
    );

    expect(result).toEqual({ ok: true, data: { value: "ok" } });
  });

  it.each([
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
    [{ "content-encoding": "x".repeat(65) }, 415, "unsupported_media_type"],
    [{ "content-encoding": "identity,gzip" }, 415, "unsupported_media_type"],
    [{ "content-length": "-1" }, 400, "invalid_request"],
    [{ "content-length": "01" }, 400, "invalid_request"],
    [{ "content-length": "+1" }, 400, "invalid_request"],
    [{ "content-length": "8192,8192" }, 400, "invalid_request"],
    [{ "content-length": "1".repeat(33) }, 400, "invalid_request"],
    [{ "content-length": "9007199254740992" }, 400, "invalid_request"],
    [{ "content-length": "8193" }, 413, "payload_too_large"],
  ])(
    "rejects framing %j before reading the body",
    async (headers, status, error) => {
      const input = request(undefined, headers);
      const getReader = vi.spyOn(input.body, "getReader");
      const result = await readValidatedJson(input, BodySchema);

      expect(result.ok).toBe(false);
      expect(result.response.status).toBe(status);
      expect(await result.response.json()).toEqual({ error });
      expect(getReader).not.toHaveBeenCalled();
    },
  );

  it("accepts exactly 8 KiB and cancels on the next streamed byte", async () => {
    const json = JSON.stringify({ value: "ok" });
    const exact = json + " ".repeat(MAX_EMAIL_REQUEST_BYTES - json.length);
    await expect(
      readValidatedJson(request(exact), BodySchema),
    ).resolves.toEqual({ ok: true, data: { value: "ok" } });

    const cancel = vi.fn();
    const stream = new ReadableStream({
      start(controller) {
        controller.enqueue(
          new TextEncoder().encode("x".repeat(MAX_EMAIL_REQUEST_BYTES)),
        );
        controller.enqueue(new Uint8Array([0x78]));
      },
      cancel,
    });
    const overflow = await readValidatedJson(request(stream), BodySchema);

    expect(overflow.ok).toBe(false);
    expect(overflow.response.status).toBe(413);
    expect(await overflow.response.json()).toEqual({
      error: "payload_too_large",
    });
    expect(cancel).toHaveBeenCalledOnce();
  });

  it("fatally rejects invalid UTF-8 before schema validation", async () => {
    const bytes = new Uint8Array(
      Buffer.from(JSON.stringify({ value: "Cliente Test" })),
    );
    const offset = Buffer.from(bytes).indexOf("Cliente Test");
    bytes[offset] = 0xff;

    const result = await readValidatedJson(request(bytes), BodySchema);
    expect(result.ok).toBe(false);
    expect(result.response.status).toBe(400);
    expect(await result.response.json()).toEqual({ error: "invalid_json" });
  });

  it("redacts schema issue paths and attacker-controlled field names", async () => {
    const reflected = "cliente@example.test";
    const result = await readValidatedJson(
      request(JSON.stringify({ value: "ok", [reflected]: true })),
      BodySchema,
    );
    const text = await result.response.text();

    expect(result.ok).toBe(false);
    expect(result.response.status).toBe(422);
    expect(JSON.parse(text)).toEqual({ error: "invalid_request" });
    expect(text).not.toContain(reflected);
  });

  it("returns hardened JSON responses", () => {
    const response = jsonResponse({ error: "invalid_request" }, 400, {
      "Cache-Control": "public",
      "Content-Type": "text/html",
      "Retry-After": "10",
      "X-Frame-Options": "SAMEORIGIN",
    });
    expect(response.headers.get("content-type")).toBe(
      "application/json; charset=utf-8",
    );
    expect(response.headers.get("cache-control")).toBe(
      "private, no-store, max-age=0",
    );
    expect(response.headers.get("x-content-type-options")).toBe("nosniff");
    expect(response.headers.get("content-security-policy")).toBe(
      "default-src 'none'; frame-ancestors 'none'",
    );
    expect(response.headers.get("x-frame-options")).toBe("DENY");
    expect(response.headers.get("retry-after")).toBe("10");
  });
});

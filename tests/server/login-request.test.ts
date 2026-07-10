import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { readBoundedLoginBody } from "@/lib/server/auth/loginRequest.ts";

function request(
  body: BodyInit | null,
  headers: Record<string, string> = { "content-type": "application/json" },
) {
  return new Request("https://app.example.test/api/auth/login", {
    method: "POST",
    headers,
    body,
  });
}

describe("bounded owner login request", () => {
  it("normalizes only the email and preserves the password", async () => {
    await expect(
      readBoundedLoginBody(
        request(
          JSON.stringify({
            email: " OWNER@EXAMPLE.TEST ",
            password: " Pass phrase 123 ",
          }),
        ),
      ),
    ).resolves.toEqual({
      ok: true,
      body: {
        email: "owner@example.test",
        password: " Pass phrase 123 ",
      },
    });
  });

  it.each([
    ["text/plain", null, 415, "UNSUPPORTED_MEDIA_TYPE"],
    ["application/json", "gzip", 415, "UNSUPPORTED_MEDIA_TYPE"],
    ["application/json", null, 400, "INVALID_JSON"],
  ])(
    "rejects unsupported or empty input",
    async (contentType, encoding, status, code) => {
      const headers: Record<string, string> = { "content-type": contentType };
      if (encoding) headers["content-encoding"] = encoding;
      await expect(
        readBoundedLoginBody(request(null, headers)),
      ).resolves.toEqual({ ok: false, status, code });
    },
  );

  it("rejects malformed credentials without reflecting fields", async () => {
    await expect(
      readBoundedLoginBody(
        request(JSON.stringify({ email: "not-email", password: "short" })),
      ),
    ).resolves.toEqual({
      ok: false,
      status: 422,
      code: "INVALID_REQUEST",
    });
  });

  it("stops a chunked body after the 4 KiB boundary", async () => {
    await expect(
      readBoundedLoginBody(request("x".repeat(4 * 1_024 + 1))),
    ).resolves.toEqual({
      ok: false,
      status: 413,
      code: "PAYLOAD_TOO_LARGE",
    });
  });

  it("rejects a declared oversized or malformed length before reading", async () => {
    for (const contentLength of ["4097", "invalid"]) {
      const result = await readBoundedLoginBody(
        request("{}", {
          "content-type": "application/json",
          "content-length": contentLength,
        }),
      );
      expect(result).toMatchObject({
        ok: false,
        status: contentLength === "4097" ? 413 : 400,
      });
    }
  });
});

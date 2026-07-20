import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { createNewsletterActionLandingGetHandler } from "@/lib/server/newsletterActionLanding.ts";

const CSRF = Buffer.alloc(32, 3).toString("base64url");
const NONCE = Buffer.alloc(18, 4).toString("base64");

function handler(action: "confirm" | "unsubscribe") {
  return createNewsletterActionLandingGetHandler({
    action,
    createCsrfToken: () => CSRF,
    createNonce: () => NONCE,
    secureCookie: true,
  });
}

describe("scanner-safe newsletter action landing", () => {
  it.each([
    ["confirm", "/newsletter/confirm", "/api/newsletter/confirm"],
    ["unsubscribe", "/newsletter/unsubscribe", "/api/newsletter/unsubscribe"],
  ] as const)(
    "renders inert %s HTML and scrubs before any fetch",
    async (action, path, apiPath) => {
      const response = handler(action)(
        new Request(`https://example.test${path}`),
      );
      const html = await response.text();

      expect(response.status).toBe(200);
      expect(response.headers.get("cache-control")).toContain("no-store");
      expect(response.headers.get("referrer-policy")).toBe("no-referrer");
      expect(response.headers.get("x-robots-tag")).toBe(
        "noindex, nofollow, noarchive",
      );
      expect(response.headers.get("content-security-policy")).toContain(
        "connect-src 'self'",
      );
      expect(response.headers.get("set-cookie")).toContain(
        `gioia_newsletter_action_csrf=${CSRF}`,
      );
      expect(response.headers.get("set-cookie")).toContain("HttpOnly");
      expect(response.headers.get("set-cookie")).toContain("SameSite=Strict");
      expect(response.headers.get("set-cookie")).toContain("Secure");
      expect(html).toContain(apiPath);
      expect(html.indexOf("history.replaceState")).toBeLessThan(
        html.indexOf("fetch("),
      );
      expect(html).not.toMatch(/google|analytics|localStorage|sessionStorage/i);
      expect(html).not.toContain("token}</");
    },
  );

  it("rejects query, wrong path, method, and body without issuing state", () => {
    const get = handler("confirm");
    for (const request of [
      new Request("https://example.test/newsletter/confirm?token=private"),
      new Request("https://example.test/newsletter/other"),
      new Request("https://example.test/newsletter/confirm", {
        method: "POST",
        body: "private",
      }),
    ]) {
      const response = get(request);
      expect(response.status).toBe(400);
      expect(response.headers.get("set-cookie")).toBeNull();
    }
  });

  it("fails closed on invalid generated material", () => {
    const get = createNewsletterActionLandingGetHandler({
      action: "confirm",
      createCsrfToken: () => "private",
      createNonce: () => "private",
    });
    expect(
      get(new Request("https://example.test/newsletter/confirm")).status,
    ).toBe(503);
  });
});

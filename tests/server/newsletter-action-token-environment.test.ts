import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { NewsletterActionTokenConfigurationError } from "@/lib/server/newsletterActionToken.ts";
import { parseNewsletterActionTokenEnvironment } from "@/lib/server/newsletterActionTokenEnvironment.ts";

const first = Buffer.alloc(32, 1).toString("base64url");
const second = Buffer.alloc(32, 2).toString("base64url");

describe("newsletter action token environment", () => {
  it("decodes and freezes an ordered rotation ring", () => {
    const configuration = parseNewsletterActionTokenEnvironment({
      NEWSLETTER_ACTION_TOKEN_KEYS: JSON.stringify({
        keys: [
          { id: "primary", secret: first },
          { id: "previous", secret: second },
        ],
      }),
    });

    expect(configuration).toEqual({
      keys: [
        { id: "primary", secret: first },
        { id: "previous", secret: second },
      ],
    });
    expect(Object.isFrozen(configuration)).toBe(true);
    expect(Object.isFrozen(configuration.keys)).toBe(true);
    expect(Object.isFrozen(configuration.keys[0])).toBe(true);
  });

  it.each([
    undefined,
    "",
    " {}",
    "{}",
    JSON.stringify({ keys: [] }),
    JSON.stringify({ keys: [{ id: "primary", secret: "private" }] }),
    JSON.stringify({
      keys: [
        { id: "duplicate", secret: first },
        { id: "duplicate", secret: second },
      ],
    }),
    "x".repeat(2_049),
  ])("rejects malformed configuration without reflecting it %#", (value) => {
    let error: unknown;
    try {
      parseNewsletterActionTokenEnvironment({
        NEWSLETTER_ACTION_TOKEN_KEYS: value,
      });
    } catch (caught) {
      error = caught;
    }
    expect(error).toBeInstanceOf(NewsletterActionTokenConfigurationError);
    expect(String(error)).not.toContain(first);
    expect(String(error)).not.toContain(second);
  });
});

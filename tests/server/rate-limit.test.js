import { describe, expect, it } from "vitest";

import { createFixedWindowRateLimiter } from "@/lib/server/rateLimit";

describe("fixed-window rate limiter", () => {
  it("rejects requests over the limit and resets at the window boundary", () => {
    let time = 1_000;
    const limiter = createFixedWindowRateLimiter({
      limit: 2,
      windowMs: 100,
      now: () => time,
    });

    expect(limiter.check("client")).toMatchObject({
      allowed: true,
      remaining: 1,
      resetAt: 1_100,
    });
    expect(limiter.check("client")).toMatchObject({
      allowed: true,
      remaining: 0,
    });
    expect(limiter.check("client")).toMatchObject({
      allowed: false,
      remaining: 0,
    });

    time = 1_100;
    expect(limiter.check("client")).toMatchObject({
      allowed: true,
      remaining: 1,
      resetAt: 1_200,
    });
  });

  it("keeps its key map bounded", () => {
    const limiter = createFixedWindowRateLimiter({
      limit: 1,
      maxKeys: 2,
      windowMs: 1_000,
      now: () => 0,
    });

    expect(limiter.check("first").allowed).toBe(true);
    expect(limiter.check("second").allowed).toBe(true);
    expect(limiter.check("third").allowed).toBe(true);
    expect(limiter.check("first").allowed).toBe(true);
    expect(limiter.check("third").allowed).toBe(false);
  });
});

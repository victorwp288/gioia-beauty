import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import {
  BookingSecurityConfigurationError,
  canonicalJson,
  hmacPrincipalScope,
  requestFingerprint,
  requestPrincipalScopeHash,
  resolveBookingHmacSecret,
} from "@/lib/server/bookingSecurity.ts";

describe("canonical booking security helpers", () => {
  it("canonicalizes JSON independently of object insertion order", () => {
    const first = { z: [3, { b: true, a: null }], a: "value" };
    const second = { a: "value", z: [3, { a: null, b: true }] };

    expect(canonicalJson(first)).toBe(canonicalJson(second));
    expect(requestFingerprint(first)).toEqual(requestFingerprint(second));
    expect(requestFingerprint(first)).toHaveLength(32);
  });

  it("rejects values that do not have one deterministic JSON encoding", () => {
    const cyclic: Record<string, unknown> = {};
    cyclic.self = cyclic;
    const sparse = Array(2);
    sparse[1] = "value";

    for (const value of [undefined, Number.NaN, Infinity, cyclic, sparse]) {
      expect(() => canonicalJson(value)).toThrow();
    }
  });

  it("changes fingerprints when a semantic request field changes", () => {
    expect(requestFingerprint({ slot: 600 })).not.toEqual(
      requestFingerprint({ slot: 615 }),
    );
  });

  it("requires strong explicit secrets remotely and permits a test fallback", () => {
    expect(
      resolveBookingHmacSecret({ APP_ENV: "test" }).byteLength,
    ).toBeGreaterThanOrEqual(32);
    expect(() => resolveBookingHmacSecret({ APP_ENV: "preview" })).toThrow(
      BookingSecurityConfigurationError,
    );
    expect(() =>
      resolveBookingHmacSecret({
        APP_ENV: "preview",
        BOOKING_HMAC_SECRET: "short",
      }),
    ).toThrow(BookingSecurityConfigurationError);
  });

  it("derives stable, secret-bound 32-byte principal scopes", () => {
    const principal = "network:192.0.2.10";
    const firstSecret = Buffer.from("a".repeat(32));
    const secondSecret = Buffer.from("b".repeat(32));

    const first = hmacPrincipalScope(principal, firstSecret);
    expect(first).toEqual(hmacPrincipalScope(principal, firstSecret));
    expect(first).not.toEqual(hmacPrincipalScope(principal, secondSecret));
    expect(first).toHaveLength(32);
    expect(first.toString("hex")).not.toContain("192.0.2.10");
  });

  it("trusts fallback forwarding headers only in local and test", () => {
    const request = new Request("https://www.gioiabeauty.net/api/bookings", {
      headers: { "x-forwarded-for": "192.0.2.10" },
    });
    const secret = "s".repeat(32);

    const testHash = requestPrincipalScopeHash(request, {
      APP_ENV: "test",
      BOOKING_HMAC_SECRET: secret,
    });
    const previewHash = requestPrincipalScopeHash(request, {
      APP_ENV: "preview",
      BOOKING_HMAC_SECRET: secret,
    });
    const unavailable = hmacPrincipalScope(
      "network:unavailable",
      Buffer.from(secret),
    );

    expect(testHash).not.toEqual(unavailable);
    expect(previewHash).toEqual(unavailable);
  });

  it("uses the trusted Vercel forwarding header remotely", () => {
    const request = new Request("https://www.gioiabeauty.net/api/bookings", {
      headers: {
        "x-vercel-forwarded-for": "2001:db8::1",
        "x-forwarded-for": "192.0.2.99",
      },
    });
    const secret = "z".repeat(32);

    expect(
      requestPrincipalScopeHash(request, {
        APP_ENV: "preview",
        BOOKING_HMAC_SECRET: secret,
      }),
    ).toEqual(hmacPrincipalScope("network:2001:db8::1", Buffer.from(secret)));
  });
});

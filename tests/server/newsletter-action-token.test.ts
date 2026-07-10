import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import {
  PublicUnsubscribeCommandSchema,
  SignedActionTokenSchema,
  safeParseNewsletterActionTokenWire,
} from "@/lib/domain/schemas/index.ts";
import { NewsletterActionTokenInputError } from "@/lib/server/newsletterActionToken.ts";

import {
  CLAIMS,
  INVALID,
  NOW,
  PREVIOUS_KEY,
  PRIMARY_KEY,
  codec,
  issue,
  rawClaims,
  signedRaw,
  verify,
  type NewsletterActionTokenKeyConfiguration,
} from "./newsletter-action-token-fixture.ts";

describe("newsletter action-token codec", () => {
  it("issues one deterministic canonical golden token", () => {
    const shuffledAndNormalized = {
      expiresAt: "2026-07-10T12:00:00.000+02:00",
      issuedAt: "2026-07-09T12:00:00.000+02:00",
      subscriberVersion: 7,
      subscriberId: CLAIMS.subscriberId.toUpperCase(),
      tokenId: CLAIMS.tokenId.toUpperCase(),
      purpose: CLAIMS.purpose,
      version: 1 as const,
    };
    const expected =
      "n1-primary_1.eyJ2ZXJzaW9uIjoxLCJwdXJwb3NlIjoibmV3c2xldHRlcl9jb25maXJtIiwidG9rZW5JZCI6ImJiYmJiYmJiLWJiYmItNGJiYi04YmJiLWJiYmJiYmJiYmJiYiIsInN1YnNjcmliZXJJZCI6ImFhYWFhYWFhLWFhYWEtNGFhYS04YWFhLWFhYWFhYWFhYWFhYSIsInN1YnNjcmliZXJWZXJzaW9uIjo3LCJpc3N1ZWRBdCI6IjIwMjYtMDctMDlUMTA6MDA6MDAuMDAwWiIsImV4cGlyZXNBdCI6IjIwMjYtMDctMTBUMTA6MDA6MDAuMDAwWiJ9._sriJ70WPh6C_Qcn7Bv88Z0Q9ocgxml38IqCHrNyv6o";

    expect(issue()).toBe(expected);
    expect(
      codec().issue({
        claims: shuffledAndNormalized,
        signingKeyId: PRIMARY_KEY.id,
        now: NOW,
      }),
    ).toBe(expected);
    expect(issue()).toBe(expected);
    expect(SignedActionTokenSchema.parse(expected)).toBe(expected);
    expect(PublicUnsubscribeCommandSchema.parse({ token: expected })).toEqual({
      token: expected,
    });
  });

  it.each(["newsletter_confirm", "newsletter_unsubscribe"] as const)(
    "authenticates time- and purpose-bound %s claims",
    (purpose) => {
      const claims = { ...CLAIMS, purpose };
      const token = issue(claims);

      expect(verify(token, purpose)).toEqual({ ok: true, claims });
      expect(
        verify(
          token,
          purpose === "newsletter_confirm"
            ? "newsletter_unsubscribe"
            : "newsletter_confirm",
        ),
      ).toEqual(INVALID);
    },
  );

  it("returns immutable fresh claims and remains intentionally replayable", () => {
    const token = issue();
    const first = verify(token);
    const second = verify(token);
    expect(first).toEqual(second);
    expect(first).not.toBe(second);
    expect(Object.isFrozen(first)).toBe(true);
    if (first.ok) {
      expect(Object.isFrozen(first.claims)).toBe(true);
      expect(Reflect.set(first.claims, "subscriberVersion", 99)).toBe(false);
    }
    expect(verify(token)).toEqual(second);
  });

  it("uses a bounded MAC-covered key ID and verifies retained keys", () => {
    const rotatingCodec = codec([PRIMARY_KEY, PREVIOUS_KEY]);
    const previousToken = rotatingCodec.issue({
      claims: CLAIMS,
      signingKeyId: PREVIOUS_KEY.id,
      now: NOW,
    });

    expect(
      rotatingCodec.issue({
        claims: CLAIMS,
        signingKeyId: PRIMARY_KEY.id,
        now: NOW,
      }),
    ).toMatch(/^n1-primary_1\./);
    expect(previousToken).toMatch(/^n1-previous_1\./);
    expect(
      rotatingCodec.verify({
        token: previousToken,
        expectedPurpose: CLAIMS.purpose,
        now: NOW,
      }).ok,
    ).toBe(true);
    expect(verify(previousToken)).toEqual(INVALID);
    for (const header of ["n1-primary_1", "n1-unknown"]) {
      expect(
        rotatingCodec.verify({
          token: previousToken.replace(/^n1-previous_1/, header),
          expectedPurpose: CLAIMS.purpose,
          now: NOW,
        }),
      ).toEqual(INVALID);
    }
  });

  it("copies injected key material before the caller can mutate configuration", () => {
    const mutableKey: NewsletterActionTokenKeyConfiguration = {
      ...PRIMARY_KEY,
    };
    const keys: NewsletterActionTokenKeyConfiguration[] = [mutableKey];
    const instance = codec(keys);
    mutableKey.id = "changed";
    mutableKey.secret = PREVIOUS_KEY.secret;
    keys.push(PREVIOUS_KEY);

    expect(
      instance.issue({
        claims: CLAIMS,
        signingKeyId: PRIMARY_KEY.id,
        now: NOW,
      }),
    ).toBe(issue());
  });

  it("accepts exact clock/lifetime/version bounds", () => {
    const issuedAt = new Date(NOW.getTime() + 5 * 60_000);
    const cases = [
      ["newsletter_confirm", 24 * 60 * 60_000],
      ["newsletter_unsubscribe", 1],
      ["newsletter_unsubscribe", 30 * 24 * 60 * 60_000],
    ] as const;
    for (const [purpose, lifetime] of cases) {
      for (const subscriberVersion of [1, 2_147_483_647]) {
        const token = codec().issue({
          claims: {
            ...CLAIMS,
            purpose,
            subscriberVersion,
            issuedAt: issuedAt.toISOString(),
            expiresAt: new Date(issuedAt.getTime() + lifetime).toISOString(),
          },
          signingKeyId: PRIMARY_KEY.id,
          now: NOW,
        });
        expect(verify(token, purpose, NOW).ok).toBe(true);
      }
    }
  });

  it.each([
    [
      "future skew",
      {
        issuedAt: "2026-07-09T12:05:00.001Z",
        expiresAt: "2026-07-10T12:05:00.001Z",
      },
    ],
    ["short confirmation", { expiresAt: "2026-07-10T09:59:59.999Z" }],
    ["long confirmation", { expiresAt: "2026-07-10T10:00:00.001Z" }],
    [
      "zero unsubscribe lifetime",
      { purpose: "newsletter_unsubscribe", expiresAt: CLAIMS.issuedAt },
    ],
    [
      "negative unsubscribe lifetime",
      {
        purpose: "newsletter_unsubscribe",
        expiresAt: "2026-07-09T09:59:59.999Z",
      },
    ],
    [
      "overlong unsubscribe lifetime",
      {
        purpose: "newsletter_unsubscribe",
        expiresAt: "2026-08-08T10:00:00.001Z",
      },
    ],
    ["zero version", { subscriberVersion: 0 }],
    ["fractional version", { subscriberVersion: 1.5 }],
    ["overflow version", { subscriberVersion: 2_147_483_648 }],
    ["NaN version", { subscriberVersion: Number.NaN }],
    ["infinite version", { subscriberVersion: Number.POSITIVE_INFINITY }],
  ] as const)("rejects invalid issue input: %s", (_label, change) => {
    expect(() =>
      codec().issue({
        claims: { ...CLAIMS, ...change },
        signingKeyId: PRIMARY_KEY.id,
        now: NOW,
      }),
    ).toThrow(NewsletterActionTokenInputError);
  });

  it("enforces time bounds independently after authenticating a payload", () => {
    const future = rawClaims({
      ...CLAIMS,
      issuedAt: "2026-07-09T12:05:00.001Z",
      expiresAt: "2026-07-10T12:05:00.001Z",
    });
    const longConfirmation = rawClaims({
      ...CLAIMS,
      expiresAt: "2026-07-10T10:00:00.001Z",
    });
    const longUnsubscribe = rawClaims({
      ...CLAIMS,
      purpose: "newsletter_unsubscribe",
      expiresAt: "2026-08-08T10:00:00.001Z",
    });
    expect(verify(signedRaw(future))).toEqual(INVALID);
    expect(verify(signedRaw(longConfirmation))).toEqual(INVALID);
    expect(
      verify(signedRaw(longUnsubscribe), "newsletter_unsubscribe"),
    ).toEqual(INVALID);
  });

  it("measures confirmation lifetime as absolute instants across DST", () => {
    const claims = {
      ...CLAIMS,
      issuedAt: "2026-03-28T12:00:00.000+01:00",
      expiresAt: "2026-03-29T13:00:00.000+02:00",
    };
    const now = new Date("2026-03-28T11:30:00.000Z");
    const token = issue(claims, now);

    expect(verify(token, "newsletter_confirm", now)).toEqual({
      ok: true,
      claims: {
        ...claims,
        issuedAt: "2026-03-28T11:00:00.000Z",
        expiresAt: "2026-03-29T11:00:00.000Z",
      },
    });
  });

  it("keeps structural wire parsing separate from authentication", () => {
    const fabricated = `n1-primary_1.AA.${"A".repeat(43)}`;
    expect(safeParseNewsletterActionTokenWire(fabricated)?.token).toBe(
      fabricated,
    );
    expect(verify(fabricated)).toEqual(INVALID);
  });

  it("rejects expiry equality, invalid clocks, and post-skew verification", () => {
    const token = issue();
    expect(
      verify(token, "newsletter_confirm", new Date(CLAIMS.expiresAt)),
    ).toEqual(INVALID);
    expect(
      verify(
        token,
        "newsletter_confirm",
        new Date(Date.parse(CLAIMS.expiresAt) - 1),
      ).ok,
    ).toBe(true);
    expect(verify(token, "newsletter_confirm", new Date(Number.NaN))).toEqual(
      INVALID,
    );
    expect(() =>
      codec().issue({
        claims: CLAIMS,
        signingKeyId: PRIMARY_KEY.id,
        now: new Date(Number.NaN),
      }),
    ).toThrow(NewsletterActionTokenInputError);
  });
});

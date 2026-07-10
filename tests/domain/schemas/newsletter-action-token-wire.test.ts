import { describe, expect, it } from "vitest";

import {
  NewsletterActionClaimsSchema,
  NewsletterActionTokenWireSchema,
  PublicCancelAppointmentCommandSchema,
  PublicUnsubscribeCommandSchema,
  NewsletterUnsubscribeTokenWireSchema,
  SignedUnsubscribeTokenSchema,
  SignedActionTokenSchema,
  safeParseNewsletterActionTokenWire,
} from "@/lib/domain/schemas/index.ts";

const SUBSCRIBER_ID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const TOKEN_ID = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const IDEMPOTENCY_KEY = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
const ISSUED_AT = new Date("2026-07-09T10:00:00.000Z");
const TAG = "A".repeat(43);
const TOKEN = `n1-key_1.AAAA.${TAG}`;

function claims(
  purpose: "newsletter_confirm" | "newsletter_unsubscribe",
  lifetimeMilliseconds: number,
) {
  return {
    version: 1,
    purpose,
    subscriberId: SUBSCRIBER_ID,
    subscriberVersion: 7,
    tokenId: TOKEN_ID,
    issuedAt: ISSUED_AT.toISOString(),
    expiresAt: new Date(
      ISSUED_AT.getTime() + lifetimeMilliseconds,
    ).toISOString(),
  };
}

describe("newsletter action purpose lifetime policy", () => {
  it.each([
    ["newsletter_confirm", 24 * 60 * 60_000],
    ["newsletter_unsubscribe", 1],
    ["newsletter_unsubscribe", 30 * 24 * 60 * 60_000],
  ] as const)("accepts exact %s lifetime %#", (purpose, lifetime) => {
    expect(
      NewsletterActionClaimsSchema.safeParse(claims(purpose, lifetime)).success,
    ).toBe(true);
  });

  it.each([
    ["newsletter_confirm", 24 * 60 * 60_000 - 1],
    ["newsletter_confirm", 24 * 60 * 60_000 + 1],
    ["newsletter_unsubscribe", 0],
    ["newsletter_unsubscribe", -1],
    ["newsletter_unsubscribe", 30 * 24 * 60 * 60_000 + 1],
  ] as const)("rejects invalid %s lifetime %#", (purpose, lifetime) => {
    expect(
      NewsletterActionClaimsSchema.safeParse(claims(purpose, lifetime)).success,
    ).toBe(false);
  });

  it("uses instant duration rather than a Rome calendar-day assumption", () => {
    expect(
      NewsletterActionClaimsSchema.parse({
        ...claims("newsletter_confirm", 24 * 60 * 60_000),
        issuedAt: "2026-03-28T12:00:00.000+01:00",
        expiresAt: "2026-03-29T13:00:00.000+02:00",
      }),
    ).toMatchObject({
      issuedAt: "2026-03-28T11:00:00.000Z",
      expiresAt: "2026-03-29T11:00:00.000Z",
    });
  });
});

describe("newsletter action token structural wire", () => {
  it("preserves an exact raw token and returns frozen fresh parts", () => {
    expect(NewsletterActionTokenWireSchema.parse(TOKEN)).toBe(TOKEN);
    const first = safeParseNewsletterActionTokenWire(TOKEN);
    const second = safeParseNewsletterActionTokenWire(TOKEN);
    expect(first).toEqual({
      token: TOKEN,
      header: "n1-key_1",
      keyId: "key_1",
      encodedPayload: "AAAA",
      encodedSignature: TAG,
    });
    expect(first).not.toBe(second);
    expect(Object.isFrozen(first)).toBe(true);
  });

  it("accepts exactly 512 ASCII bytes and rejects 513", () => {
    const exact = `n1-a.${"A".repeat(463)}.${TAG}`;
    const oversized = `n1-a.${"A".repeat(464)}.${TAG}`;
    expect(exact).toHaveLength(512);
    expect(oversized).toHaveLength(513);
    expect(safeParseNewsletterActionTokenWire(exact)?.token).toBe(exact);
    expect(safeParseNewsletterActionTokenWire(oversized)).toBeNull();
  });

  it.each([
    null,
    undefined,
    42,
    "",
    ` ${TOKEN}`,
    `${TOKEN} `,
    `\t${TOKEN}`,
    `${TOKEN}\n`,
    `\u00a0${TOKEN}`,
    `${TOKEN}\0`,
    `n2-key_1.AAAA.${TAG}`,
    `n1-key_1.AAAA`,
    `n1-key_1.AAAA.${TAG}.extra`,
    `n1-.AAAA.${TAG}`,
    `n1-${"a".repeat(17)}.AAAA.${TAG}`,
    `n1-bad-id.AAAA.${TAG}`,
    `n1-key_1..${TAG}`,
    `n1-key_1.A.${TAG}`,
    `n1-key_1.AB.${TAG}`,
    `n1-key_1.AAB.${TAG}`,
    `n1-key_1.AA=.${TAG}`,
    `n1-key_1.AA+.${TAG}`,
    `n1-key_1.AAAA.${"A".repeat(42)}`,
    `n1-key_1.AAAA.${"A".repeat(44)}`,
    `n1-key_1.AAAA.${"A".repeat(42)}B`,
    `n1-key_1.AAAA.${TAG}=`,
    `n1-key_1.AAAA.${"A".repeat(42)}*`,
  ])("rejects malformed or normalized wire input %#", (value) => {
    expect(safeParseNewsletterActionTokenWire(value)).toBeNull();
  });

  it("narrows only newsletter tokens while legacy generic tokens stay unchanged", () => {
    const generic = `${"a".repeat(16)}.${"b".repeat(16)}`;
    expect(SignedActionTokenSchema.parse(` ${generic} `)).toBe(generic);
    expect(
      PublicCancelAppointmentCommandSchema.parse({
        idempotencyKey: IDEMPOTENCY_KEY,
        token: ` ${generic} `,
      }).token,
    ).toBe(generic);
    expect(
      PublicUnsubscribeCommandSchema.safeParse({ token: ` ${TOKEN} ` }).success,
    ).toBe(false);
    expect(PublicUnsubscribeCommandSchema.parse({ token: TOKEN })).toEqual({
      token: TOKEN,
    });
    expect(SignedUnsubscribeTokenSchema).toBe(
      NewsletterUnsubscribeTokenWireSchema,
    );
    expect(SignedUnsubscribeTokenSchema.parse(TOKEN)).toBe(TOKEN);
  });
});

import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import {
  NewsletterActionTokenConfigurationError,
  NewsletterActionTokenInputError,
} from "@/lib/server/newsletterActionToken.ts";

import {
  CLAIMS,
  INVALID,
  NOW,
  OTHER_SECRET,
  PREVIOUS_KEY,
  PRIMARY_KEY,
  SECRET,
  changedCharacter,
  codec,
  createNewsletterActionTokenCodec,
  issue,
  signedBytes,
  signedPayloadSegment,
  signedRaw,
  verify,
} from "./newsletter-action-token-fixture.ts";

function withHiddenExtra<T extends object>(value: T): T {
  return Object.defineProperty(value, "extra", { value: true });
}

function accessorArray(getter: () => unknown): unknown[] {
  return Object.defineProperty([], "0", {
    enumerable: true,
    get: getter,
  });
}

describe("newsletter action-token adversarial boundary", () => {
  it("rejects header, payload, tag, key, and purpose tampering identically", () => {
    const token = issue();
    const [header, payload, tag] = token.split(".") as [string, string, string];
    for (const candidate of [
      `n2-primary_1.${payload}.${tag}`,
      `${header}.${changedCharacter(payload, 5)}.${tag}`,
      `${header}.${payload}.${changedCharacter(tag, 5)}`,
    ]) {
      expect(verify(candidate)).toEqual(INVALID);
    }
    expect(
      codec([{ id: PRIMARY_KEY.id, secret: OTHER_SECRET }]).verify({
        token,
        expectedPurpose: "newsletter_confirm",
        now: NOW,
      }),
    ).toEqual(INVALID);
  });

  it("rejects a noncanonical alias of the tag's unused final bits", () => {
    const token = issue();
    const [header, payload, tag] = token.split(".") as [string, string, string];
    const alphabet =
      "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";
    const finalIndex = alphabet.indexOf(tag.at(-1) ?? "");
    expect(finalIndex % 4).toBe(0);
    const alias = `${tag.slice(0, -1)}${alphabet[finalIndex + 1]}`;
    expect(Buffer.from(alias, "base64url")).toEqual(
      Buffer.from(tag, "base64url"),
    );
    expect(verify(`${header}.${payload}.${alias}`)).toEqual(INVALID);
  });

  it.each([
    null,
    undefined,
    "",
    " n1-primary_1.a.b",
    "n1-primary_1.a.b ",
    "n1-primary_1.payload",
    "n1-primary_1.payload.tag.extra",
    "n1-primary_1..AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA",
    "n1-primary_1.payload.",
    "n1-primary-1.payload.AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA",
    "n1-primary_1.pay=load.AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA",
    "n1-primary_1.pay+load.AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA",
    `n1-primary_1.payload.${"A".repeat(42)}`,
    `n1-primary_1.payload.${"A".repeat(44)}`,
    `n1-primary_1.payload.${"A".repeat(43)}=`,
    `n1-primary_1.payload.${"A".repeat(42)}*`,
    `n1-primary_1.${"A".repeat(456)}.${"A".repeat(43)}`,
  ])("returns one fixed failure for malformed wire input %#", (token) => {
    const result = verify(token);
    expect(result).toEqual(INVALID);
    expect(Object.isFrozen(result)).toBe(true);
  });

  it.each([
    ["invalid JSON", "not-json"],
    ["array", "[]"],
    ["null", "null"],
    ["extra claim", JSON.stringify({ ...CLAIMS, extra: true })],
    ["missing claim", JSON.stringify({ ...CLAIMS, tokenId: undefined })],
    ["version two", JSON.stringify({ ...CLAIMS, version: 2 })],
    ["invalid purpose", JSON.stringify({ ...CLAIMS, purpose: "confirm" })],
    ["invalid UUID", JSON.stringify({ ...CLAIMS, subscriberId: "not-a-uuid" })],
    ["invalid version", JSON.stringify({ ...CLAIMS, subscriberVersion: 0 })],
    [
      "invalid instant",
      JSON.stringify({ ...CLAIMS, issuedAt: "not-an-instant" }),
    ],
    [
      "noncanonical order",
      JSON.stringify({
        subscriberId: CLAIMS.subscriberId,
        version: CLAIMS.version,
        purpose: CLAIMS.purpose,
        tokenId: CLAIMS.tokenId,
        subscriberVersion: CLAIMS.subscriberVersion,
        issuedAt: CLAIMS.issuedAt,
        expiresAt: CLAIMS.expiresAt,
      }),
    ],
    ["whitespace", ` ${JSON.stringify(CLAIMS)}`],
    [
      "uppercase UUID",
      JSON.stringify({ ...CLAIMS, tokenId: CLAIMS.tokenId.toUpperCase() }),
    ],
    [
      "offset instant",
      JSON.stringify({ ...CLAIMS, issuedAt: "2026-07-09T12:00:00.000+02:00" }),
    ],
    [
      "duplicate claim",
      JSON.stringify(CLAIMS).replace('"version":1', '"version":1,"version":1'),
    ],
  ])("rejects valid-MAC noncanonical/invalid payload: %s", (_label, raw) => {
    expect(verify(signedRaw(raw))).toEqual(INVALID);
  });

  it("rejects valid MACs over fatal UTF-8 and noncanonical base64url", () => {
    expect(verify(signedBytes(Uint8Array.from([0xc3, 0x28])))).toEqual(INVALID);
    expect(verify(signedPayloadSegment("A"))).toEqual(INVALID);
  });

  it.each([
    undefined,
    "",
    "human-readable-secret-that-is-long-enough",
    SECRET.slice(1),
    `${SECRET}A`,
    `${SECRET.slice(0, -1)}p`,
    `${SECRET}=`,
    `${SECRET.slice(0, -1)}*`,
    ` ${SECRET}`,
    `${SECRET}\0`,
  ])("throws one fixed configuration error for secret %#", (secret) => {
    const error = (() => {
      try {
        createNewsletterActionTokenCodec({
          keys: [{ id: PRIMARY_KEY.id, secret: secret as string }],
        });
      } catch (caught) {
        return caught;
      }
    })();
    expect(error).toEqual(new NewsletterActionTokenConfigurationError());
    expect(String(error)).toBe(
      "NewsletterActionTokenConfigurationError: Newsletter action tokens are not configured",
    );
  });

  it.each([
    { keys: [] },
    { keys: Array(1) },
    { keys: Object.assign(Array(2), { 0: PRIMARY_KEY }) },
    { keys: Object.assign(Array(3), { 0: PRIMARY_KEY }) },
    { keys: accessorArray(() => PRIMARY_KEY) },
    {
      keys: accessorArray(() => {
        throw new Error("must not execute");
      }),
    },
    { keys: [PRIMARY_KEY, PRIMARY_KEY] },
    { keys: [{ id: "invalid-id", secret: SECRET }] },
    { keys: [{ ...PRIMARY_KEY, extra: true }] },
    { keys: [{ ...PRIMARY_KEY, [Symbol("extra")]: true }] },
    { keys: Object.assign([PRIMARY_KEY], { extra: true }) },
    { keys: [PRIMARY_KEY], extra: true },
    { ...{ keys: [PRIMARY_KEY] }, [Symbol("extra")]: true },
    withHiddenExtra({ keys: [PRIMARY_KEY] }),
    Object.defineProperty({}, "keys", { get: () => [PRIMARY_KEY] }),
    {
      keys: [
        PRIMARY_KEY,
        PREVIOUS_KEY,
        { id: "third", secret: SECRET },
        { id: "fourth", secret: OTHER_SECRET },
      ],
    },
  ])("rejects invalid or unbounded keyring %#", (configuration) => {
    expect(() =>
      createNewsletterActionTokenCodec(configuration as never),
    ).toThrow(NewsletterActionTokenConfigurationError);
  });

  it("accepts exactly three dense unique configured keys", () => {
    expect(() =>
      createNewsletterActionTokenCodec({
        keys: [
          PRIMARY_KEY,
          PREVIOUS_KEY,
          {
            id: "third_1",
            secret: Buffer.alloc(32, 0x7c).toString("base64url"),
          },
        ],
      }),
    ).not.toThrow();
  });

  it("fails closed for runtime-invalid factory and method inputs", () => {
    const revoked = Proxy.revocable({}, {});
    revoked.revoke();
    for (const configuration of [
      null,
      undefined,
      0,
      "invalid",
      revoked.proxy,
    ]) {
      expect(() =>
        createNewsletterActionTokenCodec(configuration as never),
      ).toThrow(NewsletterActionTokenConfigurationError);
    }

    const instance = codec();
    for (const input of [null, undefined, 0, "invalid"]) {
      expect(() => instance.issue(input as never)).toThrow(
        NewsletterActionTokenInputError,
      );
      expect(instance.verify(input as never)).toEqual(INVALID);
    }
    for (const signingKeyId of ["", "invalid-id", "missing"]) {
      expect(() =>
        instance.issue({ claims: CLAIMS, signingKeyId, now: NOW }),
      ).toThrow(NewsletterActionTokenInputError);
    }
    expect(
      instance.verify({
        token: issue(),
        expectedPurpose: "invalid" as never,
        now: NOW,
      }),
    ).toEqual(INVALID);
  });

  it("is a server-only injected primitive with no operational dependencies", () => {
    for (const path of [
      "lib/server/newsletterActionToken.ts",
      "lib/server/newsletterActionTokenKeyring.ts",
    ]) {
      const source = readFileSync(resolve(path), "utf8");
      expect(source.startsWith('import "server-only";')).toBe(true);
      expect(source).not.toMatch(
        /process\.env|@\/config|server\/database|fetch\s*\(|console\.|logger|cache/i,
      );
      expect(source).not.toMatch(/export const .*TokenCodec\s*=/);
      expect(source).not.toMatch(/VerifiedNewsletter|parseVerifiedNewsletter/);
    }
  });
});

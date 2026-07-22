import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import {
  createTurnstileHumanChallengeVerifier,
  parseTurnstileChallengeToken,
} from "@/lib/server/turnstileHumanChallengeVerifier.ts";

const HOSTNAME = "gioia-beauty-git-refactor.example.vercel.app";
const TOKEN = "XXXX.DUMMY.TOKEN.XXXX";
const ENVIRONMENT = Object.freeze({
  APP_ENV: "preview",
  PUBLIC_HUMAN_CHALLENGE_PROVIDER: "turnstile",
  NEXT_PUBLIC_TURNSTILE_SITE_KEY: "1x00000000000000000000AA",
  TURNSTILE_SECRET_KEY: "1x0000000000000000000000000000000AA",
  TURNSTILE_ALLOWED_HOSTNAMES_JSON: JSON.stringify([HOSTNAME]),
});

function metadata(token: string | null = TOKEN) {
  return {
    headers: new Headers(
      token === null ? {} : { "x-gioia-human-challenge": token },
    ),
  };
}

function successfulResponse(overrides: Record<string, unknown> = {}) {
  return Response.json({
    success: true,
    hostname: HOSTNAME,
    action: "public_booking",
    "error-codes": [],
    ...overrides,
  });
}

describe("Turnstile human-challenge verifier", () => {
  it("accepts a bounded printable provider token", () => {
    expect(parseTurnstileChallengeToken(TOKEN)).toBe(TOKEN);
    expect(parseTurnstileChallengeToken("a".repeat(2_048))).toHaveLength(2_048);
    expect(parseTurnstileChallengeToken("line\nbreak")).toBeNull();
  });

  it.each([null, "", "contains space", "a".repeat(2_049)])(
    "rejects malformed token %# before provider work",
    async (token) => {
      const fetchMock = vi.fn();
      const verifier = createTurnstileHumanChallengeVerifier(
        ENVIRONMENT,
        fetchMock,
      );
      await expect(
        verifier.verify(metadata(token), "public_booking"),
      ).resolves.toEqual({ verified: false });
      expect(fetchMock).not.toHaveBeenCalled();
    },
  );

  it("posts only the secret and token to the fixed Siteverify endpoint", async () => {
    const fetchMock = vi.fn(
      async (_input: RequestInfo | URL, _init?: RequestInit) =>
        successfulResponse(),
    );
    const verifier = createTurnstileHumanChallengeVerifier(
      ENVIRONMENT,
      fetchMock,
    );

    await expect(
      verifier.verify(metadata(), "public_booking"),
    ).resolves.toEqual({ verified: true });
    expect(fetchMock).toHaveBeenCalledOnce();
    const call = fetchMock.mock.calls[0];
    if (!call) throw new Error("Expected one Siteverify request");
    const [url, init] = call;
    expect(url).toBe(
      "https://challenges.cloudflare.com/turnstile/v0/siteverify",
    );
    expect(init).toMatchObject({
      method: "POST",
      cache: "no-store",
      headers: { "Content-Type": "application/json" },
      signal: expect.any(AbortSignal),
    });
    expect(JSON.parse(String(init?.body))).toEqual({
      secret: ENVIRONMENT.TURNSTILE_SECRET_KEY,
      response: TOKEN,
    });
    expect(String(init?.body)).not.toContain("remoteip");
  });

  it.each([
    ["wrong hostname", { hostname: "attacker.example" }],
    ["wrong action", { action: "public_newsletter_subscribe" }],
    ["provider rejection", { success: false }],
    ["missing hostname", { hostname: undefined }],
    ["missing action", { action: undefined }],
  ])("fails closed for %s", async (_label, overrides) => {
    const verifier = createTurnstileHumanChallengeVerifier(
      ENVIRONMENT,
      vi.fn(async () => successfulResponse(overrides)),
    );
    await expect(
      verifier.verify(metadata(), "public_booking"),
    ).resolves.toEqual({ verified: false });
  });

  it("fails closed on provider transport, status, and JSON errors", async () => {
    for (const fetchImplementation of [
      vi.fn(async () => {
        throw new Error("credential and token must stay redacted");
      }),
      vi.fn(async () => new Response("unavailable", { status: 503 })),
      vi.fn(async () => new Response("not-json", { status: 200 })),
    ]) {
      const verifier = createTurnstileHumanChallengeVerifier(
        ENVIRONMENT,
        fetchImplementation,
      );
      await expect(
        verifier.verify(metadata(), "public_booking"),
      ).resolves.toEqual({ verified: false });
    }
  });

  it("does not call Turnstile for unsupported abuse actions", async () => {
    const fetchMock = vi.fn();
    const verifier = createTurnstileHumanChallengeVerifier(
      ENVIRONMENT,
      fetchMock,
    );
    await expect(
      verifier.verify(metadata(), "public_availability"),
    ).resolves.toEqual({ verified: false });
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import {
  OWNER_SESSION_MAX_AGE_SECONDS,
  issueOwnerSessionBinding,
  verifyOwnerSessionBinding,
} from "@/lib/server/auth/sessionBinding.ts";
import {
  issueOwnerCsrfToken,
  requestHasExpectedOrigin,
  validOwnerCsrfToken,
} from "@/lib/server/auth/requestSecurity.ts";

const secret = "synthetic-owner-session-secret-32-bytes-minimum";
const anotherSecret = "another-synthetic-owner-secret-32-bytes-minimum";
const userId = "10000000-0000-4000-8000-000000000001";
const sessionId = "20000000-0000-4000-8000-000000000001";
const issuedAt = new Date("2035-01-01T12:00:00.000Z");

function binding() {
  return issueOwnerSessionBinding({
    userId,
    sessionId,
    secret,
    now: issuedAt,
  });
}

describe("owner session binding", () => {
  it("round-trips an exact user and Supabase session", () => {
    expect(
      verifyOwnerSessionBinding({
        token: binding(),
        expectedUserId: userId,
        expectedSessionId: sessionId,
        secret,
        now: new Date("2035-01-01T13:00:00.000Z"),
      }),
    ).toEqual({
      version: 1,
      userId,
      sessionId,
      issuedAt: Math.floor(issuedAt.getTime() / 1_000),
    });
  });

  it.each([
    ["another user", "30000000-0000-4000-8000-000000000001", sessionId],
    ["another session", userId, "30000000-0000-4000-8000-000000000001"],
  ])("rejects binding to %s", (_label, expectedUserId, expectedSessionId) => {
    expect(
      verifyOwnerSessionBinding({
        token: binding(),
        expectedUserId,
        expectedSessionId,
        secret,
        now: issuedAt,
      }),
    ).toBeNull();
  });

  it("rejects tampering and another signing key", () => {
    const token = binding();
    const tampered = `${token.slice(0, -1)}${token.endsWith("A") ? "B" : "A"}`;
    for (const [candidate, candidateSecret] of [
      [tampered, secret],
      [token, anotherSecret],
    ] as const) {
      expect(
        verifyOwnerSessionBinding({
          token: candidate,
          expectedUserId: userId,
          expectedSessionId: sessionId,
          secret: candidateSecret,
          now: issuedAt,
        }),
      ).toBeNull();
    }
  });

  it("enforces the fixed twelve-hour lifetime and clock-skew bound", () => {
    const accepted = new Date(
      issuedAt.getTime() + OWNER_SESSION_MAX_AGE_SECONDS * 1_000,
    );
    const expired = new Date(accepted.getTime() + 1_000);
    const tooFarBeforeIssue = new Date(issuedAt.getTime() - 61_000);

    expect(
      verifyOwnerSessionBinding({
        token: binding(),
        expectedUserId: userId,
        expectedSessionId: sessionId,
        secret,
        now: accepted,
      }),
    ).not.toBeNull();
    for (const now of [expired, tooFarBeforeIssue]) {
      expect(
        verifyOwnerSessionBinding({
          token: binding(),
          expectedUserId: userId,
          expectedSessionId: sessionId,
          secret,
          now,
        }),
      ).toBeNull();
    }
  });

  it("fails closed for an invalid verification clock", () => {
    expect(
      verifyOwnerSessionBinding({
        token: binding(),
        expectedUserId: userId,
        expectedSessionId: sessionId,
        secret,
        now: new Date(Number.NaN),
      }),
    ).toBeNull();
  });

  it.each([null, "", "a.b.c", "not-base64.signature", "x".repeat(769)])(
    "rejects malformed token %s",
    (token) => {
      expect(
        verifyOwnerSessionBinding({
          token,
          expectedUserId: userId,
          expectedSessionId: sessionId,
          secret,
          now: issuedAt,
        }),
      ).toBeNull();
    },
  );

  it("rejects weak or whitespace-padded secrets", () => {
    for (const invalidSecret of ["short", ` ${secret}`]) {
      expect(() =>
        issueOwnerSessionBinding({
          userId,
          sessionId,
          secret: invalidSecret,
          now: issuedAt,
        }),
      ).toThrow("Owner session binding is not configured");
    }
  });
});

describe("owner mutation request security", () => {
  it("uses a canonical 256-bit double-submit token", () => {
    const token = issueOwnerCsrfToken();
    expect(token).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(validOwnerCsrfToken(token, token)).toBe(true);
    expect(validOwnerCsrfToken(token, issueOwnerCsrfToken())).toBe(false);
    expect(validOwnerCsrfToken(token, `${token}=`)).toBe(false);
  });

  it("requires an exact request origin", () => {
    expect(
      requestHasExpectedOrigin(
        new Request("https://preview.example.test/api/admin/appointments", {
          method: "POST",
          headers: { origin: "https://preview.example.test" },
        }),
      ),
    ).toBe(true);
    for (const origin of [
      null,
      "https://attacker.example.test",
      "not-an-origin",
      "https://preview.example.test/path",
    ]) {
      const headers = origin ? { origin } : undefined;
      expect(
        requestHasExpectedOrigin(
          new Request("https://preview.example.test/api/admin/appointments", {
            method: "POST",
            headers,
          }),
        ),
      ).toBe(false);
    }
  });
});

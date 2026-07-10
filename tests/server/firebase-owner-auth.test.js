import { describe, expect, it, vi } from "vitest";

import {
  MAX_FIREBASE_AUTHORIZATION_BYTES,
  assertFirebaseOwnerAuthEnvironment,
  readFirebaseBearerToken,
  requireFirebaseOwner,
} from "@/lib/server/firebaseOwnerAuth";

const OWNER_EMAIL = "owner@example.test";
const SAFE_ENV = {
  APP_ENV: "test",
  FIREBASE_ADMIN_PROJECT_ID: "demo-gioia-beauty",
  FIREBASE_AUTH_EMULATOR_HOST: "127.0.0.1:9099",
  BOOKING_ADMIN_EMAIL: OWNER_EMAIL,
};

function request(authorization) {
  const headers = new Headers();
  if (authorization !== null) headers.set("authorization", authorization);
  return new Request("https://www.gioiabeauty.net/api/send", { headers });
}

describe("Firebase owner-auth sink isolation", () => {
  it("accepts only the exact demo project and Auth emulator", () => {
    expect(
      assertFirebaseOwnerAuthEnvironment({
        APP_ENV: "test",
        FIREBASE_ADMIN_PROJECT_ID: "demo-gioia-beauty",
        FIREBASE_AUTH_EMULATOR_HOST: "127.0.0.1:9099",
      }),
    ).toBe("demo-gioia-beauty");
  });

  it.each([
    {
      APP_ENV: "test",
      FIREBASE_ADMIN_PROJECT_ID: "other-project",
      FIREBASE_AUTH_EMULATOR_HOST: "127.0.0.1:9099",
    },
    {
      APP_ENV: "test",
      FIREBASE_ADMIN_PROJECT_ID: "demo-gioia-beauty",
    },
    {
      APP_ENV: "production",
      FIREBASE_ADMIN_PROJECT_ID: "demo-gioia-beauty",
      FIREBASE_AUTH_EMULATOR_HOST: "127.0.0.1:9099",
    },
  ])("rejects unsafe Firebase auth environment %#", (env) => {
    expect(() => assertFirebaseOwnerAuthEnvironment(env)).toThrow(
      /disabled|not isolated/,
    );
  });
});

describe("Firebase owner bearer boundary", () => {
  it.each([
    [null, "authentication_required"],
    ["", "authentication_required"],
    ["Basic a.b.c", "invalid_authentication"],
    ["Bearer  a.b.c", "invalid_authentication"],
    ["Bearer\ta.b.c", "invalid_authentication"],
    ["Bearer a.b.c,d.e.f", "invalid_authentication"],
    ["Bearer a.b=.c", "invalid_authentication"],
  ])("rejects noncanonical Authorization %j", (authorization, code) => {
    expect(readFirebaseBearerToken(request(authorization))).toEqual({
      ok: false,
      status: 401,
      code,
    });
  });

  it("accepts standard and unsigned-emulator JWT shapes", () => {
    expect(readFirebaseBearerToken(request("Bearer a.b.c"))).toEqual({
      ok: true,
      token: "a.b.c",
    });
    expect(readFirebaseBearerToken(request("bearer a.b."))).toEqual({
      ok: true,
      token: "a.b.",
    });
  });

  it("accepts exactly 16 KiB and rejects the next header byte", () => {
    const exact = `Bearer ${"a".repeat(
      MAX_FIREBASE_AUTHORIZATION_BYTES - 10,
    )}.b.`;
    const oversized = `Bearer ${"a".repeat(
      MAX_FIREBASE_AUTHORIZATION_BYTES - 9,
    )}.b.`;

    expect(Buffer.byteLength(exact)).toBe(MAX_FIREBASE_AUTHORIZATION_BYTES);
    expect(readFirebaseBearerToken(request(exact)).ok).toBe(true);
    expect(Buffer.byteLength(oversized)).toBe(
      MAX_FIREBASE_AUTHORIZATION_BYTES + 1,
    );
    expect(readFirebaseBearerToken(request(oversized))).toMatchObject({
      ok: false,
      code: "invalid_authentication",
    });
  });

  it("rejects malformed bearer input before loading Firebase Auth", async () => {
    const loadAuth = vi.fn();
    await expect(
      requireFirebaseOwner(request("Bearer not-a-jwt"), { loadAuth }),
    ).resolves.toMatchObject({ ok: false, code: "invalid_authentication" });
    expect(loadAuth).not.toHaveBeenCalled();
  });

  it.each([
    [
      { uid: "owner-id", email: OWNER_EMAIL, email_verified: true },
      { ok: true, userId: "owner-id" },
    ],
    [
      { uid: "owner-id", email: "other@example.test", email_verified: true },
      { ok: false, status: 403, code: "owner_authorization_required" },
    ],
    [
      { uid: "owner-id", email: OWNER_EMAIL, email_verified: false },
      { ok: false, status: 403, code: "owner_authorization_required" },
    ],
    [
      { uid: "", email: OWNER_EMAIL, email_verified: true },
      { ok: false, status: 403, code: "owner_authorization_required" },
    ],
    [null, { ok: false, status: 401, code: "invalid_authentication" }],
  ])("maps verified owner claim %#", async (decodedToken, expected) => {
    const verifyIdToken = vi.fn(async () => decodedToken);
    const loadAuth = vi.fn(async () => ({ verifyIdToken }));

    await expect(
      requireFirebaseOwner(request("Bearer a.b.c"), {
        loadAuth,
        env: SAFE_ENV,
      }),
    ).resolves.toEqual(expected);
    expect(loadAuth).toHaveBeenCalledOnce();
    expect(verifyIdToken).toHaveBeenCalledOnce();
    expect(verifyIdToken).toHaveBeenCalledWith("a.b.c");
  });

  it("enforces sink isolation even when an Auth loader is injected", async () => {
    const loadAuth = vi.fn();
    await expect(
      requireFirebaseOwner(request("Bearer a.b.c"), {
        loadAuth,
        env: { ...SAFE_ENV, APP_ENV: "production" },
      }),
    ).resolves.toEqual({
      ok: false,
      status: 503,
      code: "authentication_unavailable",
    });
    expect(loadAuth).not.toHaveBeenCalled();
  });

  it.each([
    [
      Object.assign(new Error("disabled"), { code: "auth_not_configured" }),
      503,
    ],
    [new Error("invalid token"), 401],
  ])("redacts Firebase verification failure %#", async (error, status) => {
    const verifyIdToken = vi.fn(async () => {
      throw error;
    });

    await expect(
      requireFirebaseOwner(request("Bearer a.b.c"), {
        loadAuth: async () => ({ verifyIdToken }),
        env: SAFE_ENV,
      }),
    ).resolves.toMatchObject({ ok: false, status });
  });
});

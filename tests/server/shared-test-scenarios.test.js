import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import { runBookingConcurrencySuite } from "../../scripts/booking-concurrency-suite.mjs";
import { parseLocalDatabaseUrl } from "../../scripts/concurrency-harness.mjs";
import { parseLocalRouteStatus } from "../../scripts/local-owner-auth-harness.mjs";
import { runOwnerAuthRouteScenario } from "../../scripts/owner-auth-route-scenario.mjs";

const SECURE_COOKIE_EXPECTATIONS = {
  session: {
    required: [
      "httponly",
      "path=/",
      "samesite=strict",
      "max-age=43200",
      "secure",
    ],
    forbidden: [],
  },
  csrf: {
    required: ["path=/", "samesite=strict", "max-age=43200", "secure"],
    forbidden: ["httponly"],
  },
  supabase: {
    namePrefix: "sb-lxvsspniipcotimbsfqm-auth-token",
    required: ["httponly", "path=/", "samesite=lax", "secure"],
    forbidden: [],
  },
};

function jsonResponse(status, code, extra = {}, cookies = []) {
  const headers = new Headers({
    "cache-control": "private, no-store",
    "content-type": "application/json",
  });
  for (const cookie of cookies) headers.append("set-cookie", cookie);
  return new Response(JSON.stringify({ code, ...extra }), {
    status,
    headers,
  });
}

function scenarioResponses() {
  return [
    jsonResponse(401, "OWNER_SESSION_REQUIRED"),
    jsonResponse(403, "FORBIDDEN_ORIGIN"),
    jsonResponse(
      200,
      "OWNER_SESSION_CREATED",
      { csrfToken: "synthetic-csrf-token" },
      [
        "gioia_owner_session=session-value; HttpOnly; Path=/; SameSite=Strict; Max-Age=43200; Secure",
        "gioia_owner_csrf=csrf-value; Path=/; SameSite=Strict; Max-Age=43200; Secure",
        "sb-lxvsspniipcotimbsfqm-auth-token=auth-value; HttpOnly; Path=/; SameSite=Lax; Secure",
      ],
    ),
    jsonResponse(200, "OWNER_SESSION_ACTIVE", {
      csrfToken: "synthetic-csrf-token",
    }),
    jsonResponse(200, "OWNER_SESSION_ENDED", {}, [
      "gioia_owner_session=; Max-Age=0; Path=/",
      "gioia_owner_csrf=; Max-Age=0; Path=/",
      "sb-lxvsspniipcotimbsfqm-auth-token=; Max-Age=0; Path=/",
    ]),
    jsonResponse(401, "OWNER_SESSION_REQUIRED"),
  ];
}

describe("shared Local and TEST scenarios", () => {
  it("keeps target connection discovery and credentials outside scenarios", () => {
    const bookingSource = readFileSync(
      new URL("../../scripts/booking-concurrency-suite.mjs", import.meta.url),
      "utf8",
    );
    const authSource = readFileSync(
      new URL("../../scripts/owner-auth-route-scenario.mjs", import.meta.url),
      "utf8",
    );
    const forbiddenConnectionInput =
      /\b(?:DB_URL|DATABASE_URL|databaseUrl|publishableKey|serviceRoleKey|process\.env)\b/u;

    expect(runBookingConcurrencySuite).toHaveLength(1);
    expect(runOwnerAuthRouteScenario).toHaveLength(1);
    expect(bookingSource).not.toMatch(forbiddenConnectionInput);
    expect(authSource).not.toMatch(forbiddenConnectionInput);
    expect(authSource).not.toContain("LOCAL_SYNTHETIC_OWNER");
    expect(authSource).not.toContain('from "postgres"');
  });

  it("keeps both local wrappers fail-closed against remote database URLs", () => {
    expect(() =>
      parseLocalDatabaseUrl(
        "postgresql://postgres:secret@db.remote.invalid:5432/postgres",
      ),
    ).toThrow("safe local database URL");
    expect(() =>
      parseLocalRouteStatus({
        API_URL: "http://127.0.0.1:54321",
        DB_URL: "postgresql://postgres:secret@db.remote.invalid:5432/postgres",
        PUBLISHABLE_KEY: "synthetic-local-publishable-key",
      }),
    ).toThrow("unsafe local database URL");
  });

  it("runs Auth against injected operations and an injected owner fixture", async () => {
    const owner = {
      email: "owner.ephemeral@gioia.test",
      password: "in-memory-random-password",
    };
    const requests = [];
    const responses = scenarioResponses();
    let reconciliations = 0;
    const fetchImpl = async (url, options) => {
      requests.push({ url, options });
      const response = responses.shift();
      if (!response) throw new Error("Unexpected scenario request");
      return response;
    };

    await runOwnerAuthRouteScenario({
      baseUrl: new URL("https://127.0.0.1:43123"),
      owner,
      cookieSecurity: SECURE_COOKIE_EXPECTATIONS,
      reconcileLedger: async () => {
        reconciliations += 1;
      },
      fetchImpl,
    });

    expect(responses).toHaveLength(0);
    expect(reconciliations).toBe(1);
    expect(requests.map(({ url }) => url.pathname)).toEqual([
      "/api/auth/session",
      "/api/auth/login",
      "/api/auth/login",
      "/api/auth/session",
      "/api/auth/logout",
      "/api/auth/session",
    ]);
    expect(JSON.parse(requests[2].options.body)).toEqual(owner);
    expect(requests[1].options.headers.get("origin")).toBe(
      "https://attacker.invalid",
    );
    expect(requests[4].options.headers.get("x-csrf-token")).toBe(
      "synthetic-csrf-token",
    );
    expect(requests[5].options.headers.get("cookie")).toContain(
      "gioia_owner_session=session-value",
    );
  });

  it("rejects non-loopback targets and cookies on unauthenticated responses", async () => {
    const options = {
      owner: {
        email: "owner.ephemeral@gioia.test",
        password: "in-memory-random-password",
      },
      cookieSecurity: SECURE_COOKIE_EXPECTATIONS,
      reconcileLedger: async () => {},
      fetchImpl: async () =>
        jsonResponse(401, "OWNER_SESSION_REQUIRED", {}, [
          "gioia_owner_session=unsafe; HttpOnly; Path=/",
        ]),
    };

    await expect(
      runOwnerAuthRouteScenario({
        ...options,
        baseUrl: new URL("https://www.gioiabeauty.net"),
      }),
    ).rejects.toThrow("safe HTTP base URL");
    await expect(
      runOwnerAuthRouteScenario({
        ...options,
        baseUrl: new URL("https://127.0.0.1:43123"),
      }),
    ).rejects.toThrow("issued security cookies");
  });

  it("rejects extra response fields that could carry tokens or PII", async () => {
    const responses = scenarioResponses();
    responses[2] = jsonResponse(200, "OWNER_SESSION_CREATED", {
      csrfToken: "synthetic-csrf-token",
      access_token: "must-not-be-returned",
    });
    await expect(
      runOwnerAuthRouteScenario({
        baseUrl: new URL("https://127.0.0.1:43123"),
        owner: {
          email: "owner.ephemeral@gioia.test",
          password: "in-memory-random-password",
        },
        cookieSecurity: SECURE_COOKIE_EXPECTATIONS,
        reconcileLedger: async () => {},
        fetchImpl: async () => responses.shift(),
      }),
    ).rejects.toThrow("owner login returned");
  });

  it("rejects security cookies on revoked-session replay", async () => {
    const responses = scenarioResponses();
    responses[5] = jsonResponse(401, "OWNER_SESSION_REQUIRED", {}, [
      "gioia_owner_session=unsafe-replay; HttpOnly; Path=/",
    ]);
    await expect(
      runOwnerAuthRouteScenario({
        baseUrl: new URL("https://127.0.0.1:43123"),
        owner: {
          email: "owner.ephemeral@gioia.test",
          password: "in-memory-random-password",
        },
        cookieSecurity: SECURE_COOKIE_EXPECTATIONS,
        reconcileLedger: async () => {},
        fetchImpl: async () => responses.shift(),
      }),
    ).rejects.toThrow("issued security cookies");
  });
});

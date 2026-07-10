import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { OWNER_CSRF_COOKIE } from "@/lib/server/auth/requestSecurity.ts";
import { OWNER_SESSION_BINDING_COOKIE } from "@/lib/server/auth/sessionBinding.ts";
import type {
  OwnerScheduleCommandResult,
  OwnerScheduleRepository,
} from "@/lib/server/database/ownerScheduleRepository.ts";
import {
  createNextOwnerScheduleCommandRoute,
  type NextOwnerScheduleCommandRouteDependencies,
} from "@/lib/server/nextOwnerScheduleCommandRoute.ts";
import { now, secret, setup } from "./fresh-owner-session-fixture.ts";

const CSRF_TOKEN = "A".repeat(43);
const RESOURCE_ID = "40000000-0000-4000-8000-000000000001";

function success(): OwnerScheduleCommandResult {
  return {
    http_status: 201,
    result: { code: "BLOCK_CREATED", resource_id: RESOURCE_ID },
    replayed: false,
  };
}

function repositoryFixture() {
  return {
    createAppointment: vi.fn(async () => success()),
    createBlock: vi.fn(async () => success()),
    updateAppointment: vi.fn(async () => success()),
    updateBlock: vi.fn(async () => success()),
    rescheduleAppointment: vi.fn(async () => success()),
    rescheduleBlock: vi.fn(async () => success()),
    setAppointmentStatus: vi.fn(async () => success()),
    cancelScheduleEntry: vi.fn(async () => success()),
    createVacation: vi.fn(async () => success()),
    cancelVacation: vi.fn(async () => success()),
  } satisfies OwnerScheduleRepository;
}

function refreshHeaders() {
  const headers = new Headers({
    "cache-control": "public, max-age=3600",
    expires: "0",
    "x-private-detail": "must-not-pass",
  });
  headers.append("set-cookie", "sb-auth.0=first; HttpOnly; Path=/");
  headers.append("set-cookie", "sb-auth.1=second; HttpOnly; Path=/");
  return headers;
}

function request() {
  return new Request("https://preview.example.test/api/admin/blocks", {
    method: "POST",
    headers: {
      host: "preview.example.test",
      origin: "https://preview.example.test",
      "content-type": "application/json",
      "idempotency-key": "30000000-0000-4000-8000-000000000001",
      "x-csrf-token": CSRF_TOKEN,
    },
    body: JSON.stringify({
      date: "2035-01-02",
      startMinutes: 720,
      durationMinutes: 30,
    }),
  });
}

function adapterFixture({
  bindingToken,
  responseHeaders = refreshHeaders(),
}: {
  bindingToken?: string;
  responseHeaders?: Headers;
} = {}) {
  const authFixture = setup();
  const repository = repositoryFixture();
  const signOut = vi.fn(async () => ({ error: null }));
  const setSecurityCookie = vi.fn();
  const createAuthContext = vi.fn(async () => ({
    auth: { ...authFixture.auth, signOut } as never,
    responseHeaders,
    securityCookieStore: { get: vi.fn(), set: setSecurityCookie },
    secure: true,
  }));
  const readSecurityTokens = vi.fn(async () => ({
    bindingToken: bindingToken ?? authFixture.bindingToken,
    csrfToken: CSRF_TOKEN,
  }));
  const getBindingSecret = vi.fn(() => secret);
  const dependencies = {
    repository,
    createAuthContext,
    readSecurityTokens,
    getBindingSecret,
    createRequestId: () => "50000000-0000-4000-8000-000000000001",
    now,
  } satisfies NextOwnerScheduleCommandRouteDependencies;
  return {
    createAuthContext,
    dependencies,
    getBindingSecret,
    readSecurityTokens,
    repository,
    setSecurityCookie,
    signOut,
  };
}

function expectSafeRefreshHeaders(response: Response) {
  expect(response.headers.getSetCookie()).toEqual([
    "sb-auth.0=first; HttpOnly; Path=/",
    "sb-auth.1=second; HttpOnly; Path=/",
  ]);
  expect(response.headers.get("expires")).toBe("0");
  expect(response.headers.get("x-private-detail")).toBeNull();
  expect(response.headers.get("cache-control")).toBe(
    "private, no-store, max-age=0",
  );
}

function expectSecurityCookiesExpired(
  setSecurityCookie: ReturnType<typeof vi.fn>,
) {
  expect(setSecurityCookie).toHaveBeenCalledTimes(2);
  expect(setSecurityCookie).toHaveBeenCalledWith(
    OWNER_SESSION_BINDING_COOKIE,
    "",
    expect.objectContaining({
      expires: new Date(0),
      httpOnly: true,
      maxAge: 0,
      secure: true,
    }),
  );
  expect(setSecurityCookie).toHaveBeenCalledWith(
    OWNER_CSRF_COOKIE,
    "",
    expect.objectContaining({
      expires: new Date(0),
      httpOnly: false,
      maxAge: 0,
      secure: true,
    }),
  );
}

describe("Next owner command security integration", () => {
  it("propagates only safe repeated refresh cookies on success", async () => {
    const fixture = adapterFixture();
    const response = await createNextOwnerScheduleCommandRoute(
      "createBlock",
      fixture.dependencies,
    )(request());

    expect(response.status).toBe(201);
    expectSafeRefreshHeaders(response);
    expect(fixture.setSecurityCookie).not.toHaveBeenCalled();
    expect(fixture.signOut).not.toHaveBeenCalled();
  });

  it("expires both security cookies for a rejected binding", async () => {
    const fixture = adapterFixture({ bindingToken: "invalid-binding" });
    const response = await createNextOwnerScheduleCommandRoute(
      "createBlock",
      fixture.dependencies,
    )(request());

    expect(response.status).toBe(401);
    expectSecurityCookiesExpired(fixture.setSecurityCookie);
    expect(fixture.signOut).toHaveBeenCalledWith({ scope: "local" });
    expect(fixture.repository.createBlock).not.toHaveBeenCalled();
    expectSafeRefreshHeaders(response);
  });

  it("expires both security cookies for database authorization rejection", async () => {
    const fixture = adapterFixture();
    fixture.repository.createBlock.mockRejectedValueOnce(
      Object.assign(new Error("OWNER_SESSION_MISMATCH"), { code: "PT403" }),
    );
    const response = await createNextOwnerScheduleCommandRoute(
      "createBlock",
      fixture.dependencies,
    )(request());

    expect(response.status).toBe(403);
    expectSecurityCookiesExpired(fixture.setSecurityCookie);
    expect(fixture.signOut).toHaveBeenCalledWith({ scope: "local" });
    expectSafeRefreshHeaders(response);
  });

  it.each(["token read", "Auth context", "binding secret"])(
    "fails closed when %s setup fails",
    async (failure) => {
      const fixture = adapterFixture();
      if (failure === "token read") {
        fixture.readSecurityTokens.mockRejectedValueOnce(new Error("failed"));
      } else if (failure === "Auth context") {
        fixture.createAuthContext.mockRejectedValueOnce(new Error("failed"));
      } else {
        fixture.getBindingSecret.mockImplementationOnce(() => {
          throw new Error("failed");
        });
      }

      const response = await createNextOwnerScheduleCommandRoute(
        "createBlock",
        fixture.dependencies,
      )(request());
      expect(response.status).toBe(503);
      expect(await response.json()).toMatchObject({
        code: "SERVICE_UNAVAILABLE",
      });
      expect(fixture.repository.createBlock).not.toHaveBeenCalled();
    },
  );
});

import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import {
  classifyOwnerCommandDatabaseError,
  ownerCommandDatabaseErrorResponse,
} from "@/lib/server/ownerCommandErrorResponse.ts";

const REQUEST_ID = "10000000-0000-4000-8000-000000000001";

const safeErrors = [
  ["PT400", "APPOINTMENT_CONTACT_INVALID", 400],
  ["PT400", "BLOCK_NOTE_INVALID", 400],
  ["PT400", "CANCELLATION_REASON_INVALID", 400],
  ["PT400", "COMMAND_HASH_INVALID", 400],
  ["PT400", "OWNER_DATE_IN_PAST", 400],
  ["PT400", "OWNER_SLOT_INVALID", 400],
  ["PT400", "OWNER_START_IN_PAST", 400],
  ["PT400", "SCHEDULE_INTERVAL_INVALID", 400],
  ["PT400", "SLOT_ALIGNMENT_INVALID", 400],
  ["PT400", "VACATION_DATE_IN_PAST", 400],
  ["PT400", "VACATION_DATE_RANGE_INVALID", 400],
  ["PT400", "VACATION_REASON_INVALID", 400],
  ["PT404", "ACTIVE_VARIANT_NOT_FOUND", 404],
  ["PT404", "SCHEDULE_ENTRY_NOT_FOUND", 404],
  ["PT404", "VACATION_NOT_FOUND", 404],
  ["PT409", "COMMAND_IN_PROGRESS", 409],
  ["PT409", "DATE_CLOSED_FOR_VACATION", 409],
  ["PT409", "IDEMPOTENCY_KEY_REUSED", 409],
  ["PT409", "SCHEDULE_ENTRY_NOT_CANCELLABLE", 409],
  ["PT409", "SLOT_OUTSIDE_BUSINESS_HOURS", 409],
  ["PT409", "SLOT_UNAVAILABLE", 409],
  ["PT409", "VACATION_CONFLICTS_WITH_SCHEDULE", 409],
  ["PT409", "VACATION_NOT_CANCELLABLE", 409],
  ["PT409", "VACATION_OVERLAP", 409],
  ["PT409", "VERSION_CONFLICT", 409],
] as const;

describe("owner command database error responses", () => {
  it.each([
    "OWNER_AUTHENTICATION_REQUIRED",
    "OWNER_SESSION_EXPIRED",
    "OWNER_SESSION_REQUIRED",
    "OWNER_SESSION_REVOKED",
  ])("maps exact PT401 %s to the owner session response", (message) => {
    expect(
      classifyOwnerCommandDatabaseError({ code: "PT401", message }),
    ).toEqual({ status: 401, code: "OWNER_SESSION_REQUIRED" });
  });

  it.each([
    "OWNER_AUTHORIZATION_REQUIRED",
    "OWNER_IDENTITY_MISMATCH",
    "OWNER_SESSION_MISMATCH",
  ])("maps exact PT403 %s to the owner authorization response", (message) => {
    expect(
      classifyOwnerCommandDatabaseError({ code: "PT403", message }),
    ).toEqual({ status: 403, code: "OWNER_AUTHORIZATION_REQUIRED" });
  });

  it.each(safeErrors)(
    "maps exact %s %s to %i",
    (databaseCode, message, status) => {
      expect(
        classifyOwnerCommandDatabaseError({ code: databaseCode, message }),
      ).toEqual({ status, code: message });
    },
  );

  it.each([
    null,
    new Error("database connection details"),
    { code: "08006", message: "connection failure at private host" },
    { code: "PT409", message: "UNREVIEWED_CONFLICT" },
    { code: "PT400", message: "SLOT_UNAVAILABLE" },
    { code: "PT401", message: "OWNER_SESSION_REVOKED " },
    { code: "PT403", message: "OWNER_IDENTITY_MISMATCH: private-id" },
    { code: "PT409", message: "ACTIVE_VARIANT_NOT_FOUND", detail: "secret" },
  ])("redacts unknown or mismatched database errors", (error) => {
    expect(classifyOwnerCommandDatabaseError(error)).toEqual({
      status: 503,
      code: "SERVICE_UNAVAILABLE",
    });
  });

  it("fails closed when database error fields cannot be read", () => {
    const error = Object.create(null, {
      code: { get: () => "PT409" },
      message: {
        get() {
          throw new Error("private database message");
        },
      },
    });
    expect(classifyOwnerCommandDatabaseError(error)).toEqual({
      status: 503,
      code: "SERVICE_UNAVAILABLE",
    });
  });

  it("preserves request and Auth refresh state in a private redacted response", async () => {
    const response = ownerCommandDatabaseErrorResponse(
      { code: "08006", message: "private database host unavailable" },
      REQUEST_ID,
      {
        "cache-control": "public, max-age=3600",
        "content-type": "text/plain",
        "content-security-policy": "default-src *",
        "cross-origin-resource-policy": "cross-origin",
        expires: "0",
        location: "https://attacker.invalid",
        pragma: "cache",
        "referrer-policy": "unsafe-url",
        "x-auth-refresh": "applied",
        "x-content-type-options": "off",
        "x-frame-options": "ALLOWALL",
        "x-request-id": "attacker-controlled",
      },
    );

    expect(response.status).toBe(503);
    expect(response.headers.get("cache-control")).toBe(
      "private, no-store, max-age=0",
    );
    expect(response.headers.get("content-type")).toBe(
      "application/json; charset=utf-8",
    );
    expect(response.headers.get("content-security-policy")).toBe(
      "default-src 'none'; frame-ancestors 'none'",
    );
    expect(response.headers.get("cross-origin-resource-policy")).toBe(
      "same-origin",
    );
    expect(response.headers.get("expires")).toBe("0");
    expect(response.headers.get("location")).toBeNull();
    expect(response.headers.get("pragma")).toBe("no-cache");
    expect(response.headers.get("referrer-policy")).toBe("no-referrer");
    expect(response.headers.get("x-auth-refresh")).toBeNull();
    expect(response.headers.get("x-content-type-options")).toBe("nosniff");
    expect(response.headers.get("x-frame-options")).toBe("DENY");
    expect(response.headers.get("x-request-id")).toBe(REQUEST_ID);
    expect(await response.json()).toEqual({
      code: "SERVICE_UNAVAILABLE",
      requestId: REQUEST_ID,
    });
  });

  it("preserves repeated Auth cookies without exposing database details", async () => {
    const refreshHeaders = new Headers();
    refreshHeaders.append(
      "set-cookie",
      "sb-refresh.0=first; HttpOnly; Path=/; Secure",
    );
    refreshHeaders.append(
      "set-cookie",
      "sb-refresh.1=second; HttpOnly; Path=/; Secure",
    );
    const response = ownerCommandDatabaseErrorResponse(
      {
        code: "PT409",
        message: "SLOT_UNAVAILABLE",
        detail: "conflict with private appointment identifier",
        hint: "private scheduling context",
      },
      REQUEST_ID,
      refreshHeaders,
    );

    expect(response.status).toBe(409);
    expect(response.headers.getSetCookie()).toEqual([
      "sb-refresh.0=first; HttpOnly; Path=/; Secure",
      "sb-refresh.1=second; HttpOnly; Path=/; Secure",
    ]);
    expect(await response.json()).toEqual({
      code: "SLOT_UNAVAILABLE",
      requestId: REQUEST_ID,
    });
  });
});

import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { requestFingerprint } from "@/lib/server/bookingSecurity.ts";

import {
  COMMAND_CASES,
  IDEMPOTENCY_KEY,
  PII,
  REQUEST_ID,
  RESOURCE_ID,
  SESSION_ID,
  USER_ID,
  commandRequest,
  createHandlerFixture,
  responseHeadersWithCookies,
} from "./owner-schedule-command-handler-fixture.ts";

const successCases = COMMAND_CASES.flatMap((commandCase) =>
  [false, true].map((replayed) => ({ commandCase, replayed })),
);

describe("owner schedule command handler", () => {
  it.each(successCases)(
    "returns exact $commandCase.name success when replayed=$replayed",
    async ({ commandCase, replayed }) => {
      const fixture = createHandlerFixture(commandCase, { replayed });
      const response = await fixture.handler(
        commandRequest(commandCase.rawBody),
      );
      const payload = await response.json();

      expect(response.status).toBe(commandCase.status);
      expect(payload).toEqual({
        code: commandCase.code,
        resourceId: RESOURCE_ID,
        replayed,
      });
      expect(fixture.execute).toHaveBeenCalledOnce();

      const [identity, command, fingerprint] = fixture.execute.mock.calls[0]!;
      expect(identity).toEqual({ userId: USER_ID, sessionId: SESSION_ID });
      expect(command).toEqual({
        ...commandCase.normalizedBody,
        idempotencyKey: IDEMPOTENCY_KEY,
      });
      const expectedFingerprint = requestFingerprint({
        operation: commandCase.operation,
        version: 1,
        request: commandCase.normalizedBody,
      });
      expect(fingerprint).toEqual(expectedFingerprint);
      expect(fingerprint).not.toBe(expectedFingerprint);
      expect(fixture.order).toEqual([
        "loadRuntimeContext",
        "getSession",
        "getUser",
        "execute",
      ]);
    },
  );

  it.each(COMMAND_CASES)(
    "returns a redacted replay of stored $name failure",
    async (commandCase) => {
      const fixture = createHandlerFixture(commandCase);
      fixture.execute.mockResolvedValueOnce({
        http_status: commandCase.failureStatus,
        result: { code: commandCase.failureCode },
        replayed: true,
      });

      const response = await fixture.handler(
        commandRequest(commandCase.rawBody),
      );

      expect(response.status).toBe(commandCase.failureStatus);
      expect(await response.json()).toEqual({
        code: commandCase.failureCode,
        requestId: REQUEST_ID,
      });
      expect(fixture.execute).toHaveBeenCalledOnce();
    },
  );

  it.each(["IDEMPOTENCY_KEY_REUSED", "COMMAND_IN_PROGRESS"])(
    "maps thrown %s to an exact 409 without clearing the owner",
    async (message) => {
      const commandCase = COMMAND_CASES[1]!;
      const fixture = createHandlerFixture(commandCase);
      fixture.execute.mockRejectedValueOnce(
        Object.assign(new Error(message), { code: "PT409" }),
      );

      const response = await fixture.handler(
        commandRequest(commandCase.rawBody),
      );

      expect(response.status).toBe(409);
      expect(await response.json()).toEqual({
        code: message,
        requestId: REQUEST_ID,
      });
      expect(fixture.clear).not.toHaveBeenCalled();
      expect(fixture.signOut).not.toHaveBeenCalled();
    },
  );

  it("validates the request before Auth and database work", async () => {
    const commandCase = COMMAND_CASES[1]!;
    const order: string[] = [];
    const bodySchema = commandCase.bodySchema.transform((body) => {
      order.push("requestValidated");
      return body;
    });
    const fixture = createHandlerFixture(commandCase, {
      bodySchema,
      observedOrder: order,
    });

    await fixture.handler(commandRequest(commandCase.rawBody));
    expect(order).toEqual([
      "requestValidated",
      "loadRuntimeContext",
      "getSession",
      "getUser",
      "execute",
    ]);

    const rejected = createHandlerFixture(commandCase);
    const request = commandRequest(commandCase.rawBody, {
      origin: "https://attacker.example.test",
    });
    const getReader = vi.spyOn(request.body!, "getReader");
    const response = await rejected.handler(request);

    expect(response.status).toBe(403);
    expect(getReader).not.toHaveBeenCalled();
    expect(rejected.loadRuntimeContext).not.toHaveBeenCalled();
    expect(rejected.execute).not.toHaveBeenCalled();
  });

  it.each([
    {
      label: "invalid session",
      error: {
        name: "AuthSessionMissingError",
        status: 400,
        code: "session_not_found",
      },
      status: 401,
      code: "OWNER_SESSION_REQUIRED",
      clears: true,
    },
    {
      label: "rate limit",
      error: {
        name: "AuthApiError",
        status: 429,
        code: "over_request_rate_limit",
      },
      status: 429,
      code: "RATE_LIMITED",
      clears: false,
    },
    {
      label: "Auth outage",
      error: { name: "AuthRetryableFetchError", status: 503 },
      status: 503,
      code: "SERVICE_UNAVAILABLE",
      clears: false,
    },
  ])("maps $label before database execution", async (authCase) => {
    const commandCase = COMMAND_CASES[1]!;
    const fixture = createHandlerFixture(commandCase, {
      sessionError: authCase.error,
    });

    const response = await fixture.handler(commandRequest(commandCase.rawBody));

    expect(response.status).toBe(authCase.status);
    expect(await response.json()).toEqual({
      code: authCase.code,
      requestId: REQUEST_ID,
    });
    expect(fixture.getUser).not.toHaveBeenCalled();
    expect(fixture.execute).not.toHaveBeenCalled();
    expect(fixture.clear).toHaveBeenCalledTimes(authCase.clears ? 1 : 0);
    expect(fixture.signOut).toHaveBeenCalledTimes(authCase.clears ? 1 : 0);
    expect(response.headers.get("retry-after")).toBe(
      authCase.status === 429 ? "60" : null,
    );
  });

  it.each([
    ["PT401", "OWNER_SESSION_REVOKED", 401, "OWNER_SESSION_REQUIRED"],
    ["PT403", "OWNER_SESSION_MISMATCH", 403, "OWNER_AUTHORIZATION_REQUIRED"],
  ] as const)(
    "clears signed-in state for database %s",
    async (databaseCode, message, status, responseCode) => {
      const commandCase = COMMAND_CASES[1]!;
      const fixture = createHandlerFixture(commandCase);
      fixture.execute.mockRejectedValueOnce(
        Object.assign(new Error(message), { code: databaseCode }),
      );

      const response = await fixture.handler(
        commandRequest(commandCase.rawBody),
      );

      expect(response.status).toBe(status);
      expect(await response.json()).toEqual({
        code: responseCode,
        requestId: REQUEST_ID,
      });
      expect(fixture.clear).toHaveBeenCalledOnce();
      expect(fixture.signOut).toHaveBeenCalledWith({ scope: "local" });
    },
  );

  it("redacts unknown failures while preserving only safe repeated cookies", async () => {
    const commandCase = COMMAND_CASES[0]!;
    const fixture = createHandlerFixture(commandCase, {
      responseHeaders: responseHeadersWithCookies(),
    });
    fixture.execute.mockRejectedValueOnce({
      code: "08006",
      message: `private database failure for ${PII}`,
      detail: `recipient=${PII}`,
    });

    const response = await fixture.handler(commandRequest(commandCase.rawBody));
    const responseText = await response.text();

    expect(response.status).toBe(503);
    expect(JSON.parse(responseText)).toEqual({
      code: "SERVICE_UNAVAILABLE",
      requestId: REQUEST_ID,
    });
    expect(responseText).not.toContain(PII);
    expect(response.headers.get("x-private-detail")).toBeNull();
    expect(response.headers.get("cache-control")).toBe(
      "private, no-store, max-age=0",
    );
    expect(response.headers.get("expires")).toBe("0");
    expect(response.headers.getSetCookie()).toEqual([
      "sb-auth.0=first; HttpOnly; Path=/; Secure",
      "sb-auth.1=second; HttpOnly; Path=/; Secure",
    ]);
    expect(fixture.clear).not.toHaveBeenCalled();
  });
});

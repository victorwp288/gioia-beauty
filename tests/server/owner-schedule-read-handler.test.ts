import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import {
  COUNT_QUERY,
  IDS,
  LIST_QUERY,
  NOW,
  PII,
  REQUEST_ID,
  SESSION_ID,
  USER_ID,
  appointment,
  countRequest,
  createCountFixture,
  createListFixture,
  listRequest,
  responseHeadersWithCookies,
} from "./owner-schedule-read-handler-fixture.ts";

async function body(response: Response) {
  return (await response.json()) as Record<string, unknown>;
}

function expectNoRuntime(fixture: ReturnType<typeof createListFixture>) {
  expect(fixture.loadRuntimeContext).not.toHaveBeenCalled();
  expect(fixture.getSession).not.toHaveBeenCalled();
  expect(fixture.getUser).not.toHaveBeenCalled();
  expect(fixture.authorizeSession).not.toHaveBeenCalled();
  expect(fixture.execute).not.toHaveBeenCalled();
}

describe("owner schedule read handlers", () => {
  it("constructs both handlers without clock, Auth, cursor, or executor effects", () => {
    const list = createListFixture();
    const count = createCountFixture();
    expect(list.readNow).not.toHaveBeenCalled();
    expect(list.cursorCodec.issue).not.toHaveBeenCalled();
    expect(list.cursorCodec.verify).not.toHaveBeenCalled();
    expectNoRuntime(list);
    expect(count.readNow).not.toHaveBeenCalled();
    expect(count.loadRuntimeContext).not.toHaveBeenCalled();
    expect(count.execute).not.toHaveBeenCalled();
  });

  it("authorizes and executes one exact bounded list plan", async () => {
    const fixture = createListFixture();
    const response = await fixture.handler(listRequest());

    expect(response.status).toBe(200);
    expect(await body(response)).toEqual({ items: [], nextCursor: null });
    expect(fixture.order).toEqual([
      "loadRuntimeContext",
      "getSession",
      "getUser",
      "authorizeSession",
      "execute",
    ]);
    expect(fixture.execute).toHaveBeenCalledOnce();
    expect(fixture.execute).toHaveBeenCalledWith(
      { userId: USER_ID, sessionId: SESSION_ID },
      expect.objectContaining({
        fromDate: "2035-02-01",
        toDate: "2035-02-28",
        kind: null,
        statuses: [],
        pageSize: 2,
        rowLimit: 3,
        after: null,
        order: ["date", "startMinutes", "id"],
      }),
    );
    expect(fixture.readNow).toHaveBeenCalledOnce();
    expect(fixture.cursorCodec.issue).not.toHaveBeenCalled();
    expect(fixture.cursorCodec.verify).not.toHaveBeenCalled();
  });

  it("authorizes and derives one exact bounded count response", async () => {
    const fixture = createCountFixture({
      groups: [
        { kind: "appointment", status: "confirmed", count: 2 },
        { kind: "block", status: "active", count: 1 },
      ],
    });
    const response = await fixture.handler(
      countRequest(`${COUNT_QUERY}&status=confirmed&status=active`),
    );

    expect(response.status).toBe(200);
    expect(await body(response)).toEqual({
      fromDate: "2035-02-01",
      toDate: "2035-02-28",
      total: 3,
      byKind: { appointment: 2, block: 1 },
      byStatus: {
        confirmed: 2,
        completed: 0,
        cancelled: 0,
        noShow: 0,
        active: 1,
      },
    });
    expect(fixture.execute).toHaveBeenCalledWith(
      { userId: USER_ID, sessionId: SESSION_ID },
      {
        fromDate: "2035-02-01",
        toDate: "2035-02-28",
        kind: null,
        statuses: ["active", "confirmed"],
        rowLimit: 7,
      },
    );
  });

  it("returns a cursor only for a validated lookahead and consumes it", async () => {
    const first = createListFixture({
      rows: [
        appointment(IDS[0]),
        appointment(IDS[1], { startMinutes: 660 }),
        appointment(IDS[2], { startMinutes: 720 }),
      ],
    });
    const firstResponse = await first.handler(listRequest());
    const firstBody = await body(firstResponse);
    expect(firstResponse.status).toBe(200);
    expect((firstBody.items as unknown[]).length).toBe(2);
    expect(firstBody.nextCursor).toEqual(expect.any(String));
    expect(first.cursorCodec.issue).toHaveBeenCalledOnce();
    expect(first.cursorCodec.verify).toHaveBeenCalledOnce();

    const second = createListFixture();
    const secondResponse = await second.handler(
      listRequest(`${LIST_QUERY}&cursor=${firstBody.nextCursor as string}`),
    );
    expect(secondResponse.status).toBe(200);
    expect(second.cursorCodec.verify).toHaveBeenCalledOnce();
    expect(second.execute.mock.calls[0]?.[1]).toMatchObject({
      after: { date: "2035-02-10", startMinutes: 660, id: IDS[1] },
    });
  });

  it.each([
    ["list", "fromDate=2035-02-01", 422, "INVALID_QUERY"],
    ["list", `${LIST_QUERY}&unknown=1`, 422, "INVALID_QUERY"],
    ["list", `${LIST_QUERY}&fromDate=2035-02-02`, 422, "INVALID_QUERY"],
    ["list", `${LIST_QUERY}&pageSize=01`, 422, "INVALID_QUERY"],
    ["list", `${LIST_QUERY}&pageSize=0`, 422, "INVALID_QUERY"],
    ["list", `${LIST_QUERY}&pageSize=101`, 422, "INVALID_QUERY"],
    [
      "list",
      `${LIST_QUERY}&status=confirmed&status=confirmed`,
      422,
      "INVALID_QUERY",
    ],
    [
      "list",
      "fromDate=0000-02-01&toDate=0000-02-28&pageSize=2",
      422,
      "INVALID_QUERY",
    ],
    ["list", "fromDate=2035-02-01&toDate=2035-03-05", 422, "INVALID_QUERY"],
    [
      "list",
      `${LIST_QUERY}&kind=appointment&status=active`,
      422,
      "INVALID_QUERY",
    ],
    ["count", `${COUNT_QUERY}&cursor=x`, 422, "INVALID_QUERY"],
    ["count", `${COUNT_QUERY}&pageSize=2`, 422, "INVALID_QUERY"],
  ])(
    "rejects invalid %s query before clock, context, Auth, or executor",
    async (kind, query, status, code) => {
      const fixture =
        kind === "list" ? createListFixture() : createCountFixture();
      const response = await fixture.handler(
        kind === "list" ? listRequest(query) : countRequest(query),
      );
      expect(response.status).toBe(status);
      expect(await body(response)).toEqual({ code, requestId: REQUEST_ID });
      expect(response.headers.get("x-request-id")).toBe(REQUEST_ID);
      expect(fixture.readNow).not.toHaveBeenCalled();
      expect(fixture.loadRuntimeContext).not.toHaveBeenCalled();
      expect(fixture.execute).not.toHaveBeenCalled();
    },
  );

  it("rejects oversized queries before clock, context, Auth, or executor", async () => {
    const fixture = createListFixture();
    const response = await fixture.handler(
      listRequest(`padding=${"x".repeat(1_100)}`),
    );
    expect(response.status).toBe(414);
    expect(await body(response)).toEqual({
      code: "QUERY_TOO_LARGE",
      requestId: REQUEST_ID,
    });
    expect(fixture.readNow).not.toHaveBeenCalled();
    expectNoRuntime(fixture);
  });

  it("rejects a non-GET body and pair overrun before clock or Auth", async () => {
    const methodFixture = createListFixture();
    const methodResponse = await methodFixture.handler(
      new Request(
        `https://preview.example.test/api/admin/schedule?${LIST_QUERY}&unknown=1`,
        { method: "POST", body: "private body" },
      ),
    );
    expect(methodResponse.status).toBe(400);
    expect(await body(methodResponse)).toEqual({
      code: "INVALID_REQUEST",
      requestId: REQUEST_ID,
    });
    expect(methodFixture.readNow).not.toHaveBeenCalled();
    expectNoRuntime(methodFixture);

    const pairsFixture = createListFixture();
    const pairs = `${LIST_QUERY}&${Array.from(
      { length: 9 },
      (_, index) => `extra${index}=x`,
    ).join("&")}`;
    const pairResponse = await pairsFixture.handler(listRequest(pairs));
    expect(pairResponse.status).toBe(422);
    expect(pairsFixture.readNow).not.toHaveBeenCalled();
    expectNoRuntime(pairsFixture);
  });

  it("rejects an unauthenticated cursor before context or Auth", async () => {
    const fixture = createListFixture();
    const cursor = `c1-key.e30.${"A".repeat(43)}`;
    const response = await fixture.handler(
      listRequest(`${LIST_QUERY}&cursor=${cursor}`),
    );
    expect(response.status).toBe(400);
    expect(await body(response)).toEqual({
      code: "INVALID_CURSOR",
      requestId: REQUEST_ID,
    });
    expect(fixture.cursorCodec.verify).toHaveBeenCalledOnce();
    expectNoRuntime(fixture);
  });

  it("rejects a valid cursor replayed under different filters before Auth", async () => {
    const first = createListFixture({
      rows: [
        appointment(IDS[0]),
        appointment(IDS[1], { startMinutes: 660 }),
        appointment(IDS[2], { startMinutes: 720 }),
      ],
    });
    const firstBody = await body(await first.handler(listRequest()));
    const second = createListFixture();
    const response = await second.handler(
      listRequest(
        `${LIST_QUERY}&kind=appointment&cursor=${firstBody.nextCursor as string}`,
      ),
    );
    expect(response.status).toBe(400);
    expect(await body(response)).toEqual({
      code: "INVALID_CURSOR",
      requestId: REQUEST_ID,
    });
    expectNoRuntime(second);
  });

  it("fails closed on an invalid clock before context or Auth", async () => {
    const fixture = createListFixture({
      readNow: () => new Date(Number.NaN),
    });
    const response = await fixture.handler(listRequest());
    expect(response.status).toBe(503);
    expectNoRuntime(fixture);
  });

  it.each([
    {
      label: "missing session",
      options: { sessionMissing: true },
      status: 401,
      code: "OWNER_SESSION_REQUIRED",
      clears: true,
    },
    {
      label: "Auth rate limit",
      options: {
        sessionError: {
          name: "AuthApiError",
          status: 429,
          code: "over_request_rate_limit",
        },
      },
      status: 429,
      code: "RATE_LIMITED",
      clears: false,
    },
    {
      label: "Auth outage",
      options: {
        sessionError: { name: "AuthRetryableFetchError", status: 503 },
      },
      status: 503,
      code: "SERVICE_UNAVAILABLE",
      clears: false,
    },
    {
      label: "user verification rate limit",
      options: {
        userError: {
          name: "AuthApiError",
          status: 429,
          code: "over_request_rate_limit",
        },
      },
      status: 429,
      code: "RATE_LIMITED",
      clears: false,
    },
    {
      label: "owner session revoked",
      options: {
        authorization: {
          ok: false,
          status: 401,
          code: "OWNER_SESSION_REQUIRED",
        } as const,
      },
      status: 401,
      code: "OWNER_SESSION_REQUIRED",
      clears: true,
    },
    {
      label: "owner disabled",
      options: {
        authorization: {
          ok: false,
          status: 403,
          code: "OWNER_AUTHORIZATION_REQUIRED",
        } as const,
      },
      status: 403,
      code: "OWNER_AUTHORIZATION_REQUIRED",
      clears: true,
    },
    {
      label: "authorization outage",
      options: { authorizationError: new Error("private outage") },
      status: 503,
      code: "SERVICE_UNAVAILABLE",
      clears: false,
    },
  ])("maps $label before executor", async (authCase) => {
    const fixture = createCountFixture(authCase.options);
    const response = await fixture.handler(countRequest());
    expect(response.status).toBe(authCase.status);
    expect(await body(response)).toEqual({
      code: authCase.code,
      requestId: REQUEST_ID,
    });
    expect(fixture.execute).not.toHaveBeenCalled();
    expect(fixture.clear).toHaveBeenCalledTimes(authCase.clears ? 1 : 0);
    expect(fixture.signOut).toHaveBeenCalledTimes(authCase.clears ? 1 : 0);
    expect(response.headers.get("retry-after")).toBe(
      authCase.status === 429 ? "60" : null,
    );
  });

  it("clears a bad binding before authorization or executor", async () => {
    const fixture = createCountFixture({ bindingToken: null });
    const response = await fixture.handler(countRequest());
    expect(response.status).toBe(401);
    expect(fixture.authorizeSession).not.toHaveBeenCalled();
    expect(fixture.execute).not.toHaveBeenCalled();
    expect(fixture.clear).toHaveBeenCalledOnce();
    expect(fixture.signOut).toHaveBeenCalledOnce();
  });

  it("fails closed on a malformed authorization decision", async () => {
    const fixture = createCountFixture();
    fixture.authorizeSession.mockResolvedValueOnce({
      ok: false,
      status: 418,
      code: PII,
    } as never);
    const response = await fixture.handler(countRequest());
    const text = await response.text();
    expect(response.status).toBe(503);
    expect(text).not.toContain(PII);
    expect(fixture.execute).not.toHaveBeenCalled();
    expect(fixture.clear).not.toHaveBeenCalled();
  });

  it.each([
    { ok: "true" },
    { ok: 1 },
    { ok: true, extra: PII },
    { ok: false, status: "401", code: "OWNER_SESSION_REQUIRED" },
  ])(
    "rejects noncanonical authorization %# before executor",
    async (decision) => {
      const fixture = createCountFixture();
      fixture.authorizeSession.mockResolvedValueOnce(decision as never);
      const response = await fixture.handler(countRequest());
      const text = await response.text();
      expect(response.status).toBe(503);
      expect(text).not.toContain(PII);
      expect(fixture.execute).not.toHaveBeenCalled();
      expect(fixture.clear).not.toHaveBeenCalled();
    },
  );

  it("returns 503 if security-cookie clearing fails", async () => {
    const fixture = createCountFixture({
      sessionMissing: true,
      clearError: new Error("private clear failure"),
    });
    const response = await fixture.handler(countRequest());
    expect(response.status).toBe(503);
    expect(fixture.signOut).not.toHaveBeenCalled();
  });

  it("keeps the rejection authoritative when local sign-out throws", async () => {
    const fixture = createCountFixture({
      sessionMissing: true,
      signOutError: new Error("private signout failure"),
    });
    const response = await fixture.handler(countRequest());
    expect(response.status).toBe(401);
    expect(fixture.clear).toHaveBeenCalledOnce();
    expect(fixture.signOut).toHaveBeenCalledOnce();
  });

  it.each([
    ["PT401", "OWNER_SESSION_REVOKED", 401, "OWNER_SESSION_REQUIRED"],
    ["PT403", "OWNER_SESSION_MISMATCH", 403, "OWNER_AUTHORIZATION_REQUIRED"],
  ] as const)(
    "maps executor %s authorization races and clears state",
    async (databaseCode, message, status, code) => {
      const fixture = createCountFixture({
        executeError: Object.assign(new Error(message), {
          code: databaseCode,
        }),
      });
      const response = await fixture.handler(countRequest());
      expect(response.status).toBe(status);
      expect(await body(response)).toEqual({ code, requestId: REQUEST_ID });
      expect(fixture.execute).toHaveBeenCalledOnce();
      expect(fixture.clear).toHaveBeenCalledOnce();
      expect(fixture.signOut).toHaveBeenCalledOnce();
    },
  );

  it.each([
    new Error(`${PII} secret-token`),
    Object.assign(new Error("COMMAND_IN_PROGRESS"), { code: "PT409" }),
  ])("redacts unknown executor failures", async (failure) => {
    const fixture = createCountFixture({ executeError: failure });
    const response = await fixture.handler(countRequest());
    const text = await response.text();
    expect(response.status).toBe(503);
    expect(JSON.parse(text)).toEqual({
      code: "SERVICE_UNAVAILABLE",
      requestId: REQUEST_ID,
    });
    expect(text).not.toContain(PII);
    expect(fixture.execute).toHaveBeenCalledOnce();
    expect(fixture.clear).not.toHaveBeenCalled();
  });

  it("fails closed on malformed list and count executor results", async () => {
    const list = createListFixture({
      rows: [{ ...appointment(IDS[0]), privateValue: PII }],
      responseHeaders: responseHeadersWithCookies(),
    });
    const listResponse = await list.handler(listRequest());
    expect(listResponse.status).toBe(503);
    expect(await listResponse.text()).not.toContain(PII);
    expect(listResponse.headers.getSetCookie()).toHaveLength(2);
    expect(listResponse.headers.get("x-private-detail")).toBeNull();

    const count = createCountFixture({
      groups: [{ kind: "appointment", status: "confirmed", count: 0 }],
    });
    const countResponse = await count.handler(countRequest());
    expect(countResponse.status).toBe(503);
    expect(count.execute).toHaveBeenCalledOnce();
  });

  it("preserves trusted Auth cookies and Expires while enforcing private headers", async () => {
    const fixture = createListFixture({
      responseHeaders: responseHeadersWithCookies(),
    });
    const response = await fixture.handler(listRequest());
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe(
      "private, no-store, max-age=0",
    );
    expect(response.headers.get("pragma")).toBe("no-cache");
    expect(response.headers.get("content-security-policy")).toBe(
      "default-src 'none'; frame-ancestors 'none'",
    );
    expect(response.headers.get("cross-origin-resource-policy")).toBe(
      "same-origin",
    );
    expect(response.headers.get("access-control-allow-origin")).toBeNull();
    expect(response.headers.get("x-private-detail")).toBeNull();
    expect(response.headers.get("expires")).toBe("0");
    expect(response.headers.getSetCookie()).toEqual([
      "sb-auth.0=first; HttpOnly; Path=/; Secure",
      "sb-auth.1=second; HttpOnly; Path=/; Secure",
    ]);
  });

  it("preserves filtered refresh cookies on a post-context rate limit", async () => {
    const fixture = createCountFixture({
      sessionError: {
        name: "AuthApiError",
        status: 429,
        code: "over_request_rate_limit",
      },
      responseHeaders: responseHeadersWithCookies(),
    });
    const response = await fixture.handler(countRequest());
    expect(response.status).toBe(429);
    expect(response.headers.get("retry-after")).toBe("60");
    expect(response.headers.get("cache-control")).toBe(
      "private, no-store, max-age=0",
    );
    expect(response.headers.get("access-control-allow-origin")).toBeNull();
    expect(response.headers.get("x-private-detail")).toBeNull();
    expect(response.headers.getSetCookie()).toEqual([
      "sb-auth.0=first; HttpOnly; Path=/; Secure",
      "sb-auth.1=second; HttpOnly; Path=/; Secure",
    ]);
  });
});

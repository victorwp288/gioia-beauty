import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import {
  createOwnerSubscriberListGetHandler,
  createOwnerVacationListGetHandler,
} from "@/lib/server/ownerVacationSubscriberReadHandler.ts";

import {
  IDS,
  NOW,
  PII,
  REQUEST_ID,
  SESSION_ID,
  USER_ID,
  createRuntimeFixture,
  responseHeadersWithCookies,
} from "./owner-schedule-read-handler-fixture.ts";
import { cursorCodec as createCursorCodec } from "./pagination-cursor-fixture.ts";

function vacation(overrides: Record<string, unknown> = {}) {
  return {
    id: IDS[0],
    schemaVersion: 1,
    startDate: "2035-01-20",
    endDate: "2035-02-05",
    status: "active",
    reason: "Chiusura",
    source: "admin",
    cancelledAt: null,
    cancelledBy: null,
    version: 1,
    createdAt: "2035-01-10T08:00:00.000Z",
    updatedAt: "2035-01-10T08:00:00.000Z",
    ...overrides,
  };
}

function subscriber(overrides: Record<string, unknown> = {}) {
  return {
    cursorCreatedAt: "2035-01-10T08:00:00.123456Z",
    item: {
      id: IDS[0],
      schemaVersion: 1,
      email: PII,
      status: "active",
      source: "public",
      consentAt: "2035-01-10T07:58:00.000Z",
      consentSource: "website-footer",
      consentPolicyVersion: "2035-01",
      confirmedAt: "2035-01-10T07:59:00.000Z",
      unsubscribedAt: null,
      version: 1,
      createdAt: "2035-01-10T08:00:00.123Z",
      updatedAt: "2035-01-10T08:00:00.123Z",
      ...overrides,
    },
  };
}

function fixture(kind: "vacation" | "subscriber", rows: unknown) {
  const runtime = createRuntimeFixture({
    responseHeaders: responseHeadersWithCookies(),
  });
  const baseCodec = createCursorCodec();
  const cursorCodec = {
    issue: vi.fn((input) => baseCodec.issue(input)),
    verify: vi.fn((input) => baseCodec.verify(input)),
  };
  const execute = vi.fn(async () => {
    runtime.order.push("execute");
    return rows;
  });
  const options = {
    cursorCodec,
    loadRuntimeContext: runtime.loadRuntimeContext,
    execute,
    createRequestId: () => REQUEST_ID,
    readNow: runtime.readNow,
  };
  const handler =
    kind === "vacation"
      ? createOwnerVacationListGetHandler(options)
      : createOwnerSubscriberListGetHandler(options);
  return { ...runtime, cursorCodec, execute, handler };
}

function request(path: string, query: string) {
  return new Request(`https://preview.example.test${path}?${query}`);
}

describe("owner vacation and subscriber read handlers", () => {
  it("authorizes one bounded overlapping-vacation page", async () => {
    const test = fixture("vacation", [vacation()]);
    const response = await test.handler(
      request(
        "/api/admin/vacations",
        "fromDate=2035-02-01&toDate=2035-02-28&pageSize=2",
      ),
    );

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      items: [vacation()],
      nextCursor: null,
    });
    expect(test.execute).toHaveBeenCalledWith(
      { userId: USER_ID, sessionId: SESSION_ID },
      expect.objectContaining({
        fromDate: "2035-02-01",
        toDate: "2035-02-28",
        pageSize: 2,
        rowLimit: 3,
        after: null,
        order: ["startDate", "id"],
      }),
    );
    expect(response.headers.get("cache-control")).toBe(
      "private, no-store, max-age=0",
    );
    expect(response.headers.getSetCookie()).toHaveLength(2);
  });

  it("authorizes one newest-first subscriber page without losing cursor precision", async () => {
    const test = fixture("subscriber", [subscriber()]);
    const response = await test.handler(
      request(
        "/api/admin/subscribers",
        "status=active&status=pending&pageSize=2",
      ),
    );

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      items: [subscriber().item],
      nextCursor: null,
    });
    expect(test.execute).toHaveBeenCalledWith(
      { userId: USER_ID, sessionId: SESSION_ID },
      expect.objectContaining({
        statuses: ["active", "pending"],
        pageSize: 2,
        rowLimit: 3,
        after: null,
        order: [
          { field: "createdAt", direction: "desc" },
          { field: "id", direction: "desc" },
        ],
      }),
    );
  });

  it.each([
    ["vacation", "/api/admin/vacations", "fromDate=2035-02-01"],
    ["subscriber", "/api/admin/subscribers", "status=active&status=active"],
    ["subscriber", "/api/admin/subscribers", "pageSize=101"],
  ] as const)(
    "rejects invalid %s queries before clock, context, Auth, or execution",
    async (kind, path, query) => {
      const test = fixture(kind, []);
      const response = await test.handler(request(path, query));
      expect(response.status).toBe(422);
      expect(await response.json()).toEqual({
        code: "INVALID_QUERY",
        requestId: REQUEST_ID,
      });
      expect(test.readNow).not.toHaveBeenCalled();
      expect(test.loadRuntimeContext).not.toHaveBeenCalled();
      expect(test.execute).not.toHaveBeenCalled();
    },
  );

  it("rejects unauthenticated cursors before runtime loading", async () => {
    const test = fixture("subscriber", []);
    const cursor = `c1-key.e30.${"A".repeat(43)}`;
    const response = await test.handler(
      request("/api/admin/subscribers", `pageSize=2&cursor=${cursor}`),
    );
    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({
      code: "INVALID_CURSOR",
      requestId: REQUEST_ID,
    });
    expect(test.loadRuntimeContext).not.toHaveBeenCalled();
    expect(test.execute).not.toHaveBeenCalled();
  });

  it("redacts malformed PII-bearing executor output", async () => {
    const test = fixture("subscriber", [
      { ...subscriber(), privateValue: `secret ${PII}` },
    ]);
    const response = await test.handler(
      request("/api/admin/subscribers", "pageSize=2"),
    );
    const text = await response.text();
    expect(response.status).toBe(503);
    expect(text).not.toContain(PII);
    expect(JSON.parse(text)).toEqual({
      code: "SERVICE_UNAVAILABLE",
      requestId: REQUEST_ID,
    });
    expect(response.headers.getSetCookie()).toHaveLength(2);
  });
});

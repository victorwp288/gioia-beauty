import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { createOwnerOutboxListGetHandler } from "@/lib/server/ownerOutboxReadHandler.ts";

import {
  IDS,
  PII,
  REQUEST_ID,
  SESSION_ID,
  USER_ID,
  createRuntimeFixture,
  responseHeadersWithCookies,
} from "./owner-schedule-read-handler-fixture.ts";
import { cursorCodec as createCursorCodec } from "./pagination-cursor-fixture.ts";

function outboxRow(overrides: Record<string, unknown> = {}) {
  return {
    cursorCreatedAt: "2035-01-10T08:00:00.123456Z",
    item: {
      id: IDS[0],
      aggregateKind: "schedule_entry",
      aggregateId: IDS[1],
      aggregateVersion: 1,
      recipientKind: "customer",
      recipientAddress: PII,
      templateKind: "booking_customer",
      status: "pending",
      providerMessageId: null,
      attemptCount: 0,
      nextAttemptAt: "2035-01-10T08:00:00.123Z",
      lastErrorCode: null,
      sentAt: null,
      version: 1,
      createdAt: "2035-01-10T08:00:00.123Z",
      updatedAt: "2035-01-10T08:00:00.123Z",
      ...overrides,
    },
  };
}

function fixture(rows: unknown) {
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
  const handler = createOwnerOutboxListGetHandler({
    cursorCodec,
    loadRuntimeContext: runtime.loadRuntimeContext,
    execute,
    createRequestId: () => REQUEST_ID,
    readNow: runtime.readNow,
  });
  return { ...runtime, cursorCodec, execute, handler };
}

function request(query = "status=sent&status=pending&pageSize=2") {
  return new Request(`https://preview.example.test/api/admin/outbox?${query}`);
}

describe("owner outbox list handler", () => {
  it("authorizes one bounded newest-first PII-bearing page", async () => {
    const test = fixture([outboxRow()]);
    const response = await test.handler(request());

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      items: [outboxRow().item],
      nextCursor: null,
    });
    expect(test.execute).toHaveBeenCalledWith(
      { userId: USER_ID, sessionId: SESSION_ID },
      expect.objectContaining({
        statuses: ["pending", "sent"],
        pageSize: 2,
        rowLimit: 3,
        after: null,
        order: [
          { field: "createdAt", direction: "desc" },
          { field: "id", direction: "desc" },
        ],
      }),
    );
    expect(response.headers.get("cache-control")).toBe(
      "private, no-store, max-age=0",
    );
    expect(response.headers.get("cross-origin-resource-policy")).toBe(
      "same-origin",
    );
    expect(response.headers.getSetCookie()).toHaveLength(2);
  });

  it.each([
    "status=pending&status=pending",
    "pageSize=101",
    "unknown=1",
    Array.from({ length: 10 }, (_, index) => `status=pending${index}`).join(
      "&",
    ),
  ])(
    "rejects invalid query %s before clock, Auth, or execution",
    async (query) => {
      const test = fixture([]);
      const response = await test.handler(request(query));
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

  it("rejects an unauthenticated cursor before runtime loading", async () => {
    const test = fixture([]);
    const cursor = `c1-key.e30.${"A".repeat(43)}`;
    const response = await test.handler(request(`pageSize=2&cursor=${cursor}`));
    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({
      code: "INVALID_CURSOR",
      requestId: REQUEST_ID,
    });
    expect(test.loadRuntimeContext).not.toHaveBeenCalled();
    expect(test.execute).not.toHaveBeenCalled();
  });

  it("redacts malformed recipient-bearing executor output", async () => {
    const test = fixture([{ ...outboxRow(), privateValue: `secret ${PII}` }]);
    const response = await test.handler(request());
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

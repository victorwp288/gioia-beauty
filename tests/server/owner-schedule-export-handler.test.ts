import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { createOwnerScheduleExportGetHandler } from "@/lib/server/ownerScheduleExportHandler.ts";

import {
  IDS,
  PII,
  REQUEST_ID,
  SESSION_ID,
  USER_ID,
  appointment,
  createRuntimeFixture,
  responseHeadersWithCookies,
} from "./owner-schedule-read-handler-fixture.ts";
import { cursorCodec as createCursorCodec } from "./pagination-cursor-fixture.ts";

const QUERY =
  "fromDate=2035-02-01&toDate=2035-02-28&includeNotes=false&pageSize=2";

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
  const handler = createOwnerScheduleExportGetHandler({
    cursorCodec,
    loadRuntimeContext: runtime.loadRuntimeContext,
    execute,
    createRequestId: () => REQUEST_ID,
    readNow: runtime.readNow,
  });
  return { ...runtime, cursorCodec, execute, handler };
}

function request(query = QUERY) {
  return new Request(
    `https://preview.example.test/api/admin/schedule/export?${query}`,
  );
}

describe("owner schedule export handler", () => {
  it("returns one private bounded CSV page with an authenticated continuation", async () => {
    const test = fixture([
      appointment(IDS[0]),
      appointment(IDS[1], { startMinutes: 660 }),
      appointment(IDS[2], { startMinutes: 720 }),
    ]);
    const response = await test.handler(request());
    const bytes = new Uint8Array(await response.arrayBuffer());
    const csv = new TextDecoder().decode(bytes);

    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe(
      "text/csv; charset=utf-8",
    );
    expect(response.headers.get("content-disposition")).toBe(
      'attachment; filename="gioia-beauty-schedule-2035-02-01_to_2035-02-28.csv"',
    );
    expect(response.headers.get("x-export-row-count")).toBe("2");
    expect(response.headers.get("x-next-cursor")).toMatch(/^c1-/);
    expect(response.headers.get("cache-control")).toBe(
      "private, no-store, max-age=0",
    );
    expect(response.headers.get("cross-origin-resource-policy")).toBe(
      "same-origin",
    );
    expect(response.headers.getSetCookie()).toHaveLength(2);
    expect([...bytes.slice(0, 3)]).toEqual([0xef, 0xbb, 0xbf]);
    expect(csv.startsWith('"id","schema_version"')).toBe(true);
    expect(csv).toContain(PII);
    expect(csv).not.toContain("client_note");
    expect(test.execute).toHaveBeenCalledWith(
      { userId: USER_ID, sessionId: SESSION_ID },
      expect.objectContaining({
        fromDate: "2035-02-01",
        toDate: "2035-02-28",
        format: "csv",
        includeNotes: false,
        pageSize: 2,
        rowLimit: 3,
        after: null,
        order: ["date", "startMinutes", "id"],
      }),
    );
  });

  it.each([
    "fromDate=2035-02-01",
    `${QUERY}&includeNotes=true`,
    `${QUERY}&pageSize=501`,
    `${QUERY}&unknown=1`,
  ])("rejects invalid query %s before clock or Auth", async (query) => {
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
  });

  it("returns fixed JSON and no CSV PII for malformed executor output", async () => {
    const test = fixture([
      { ...appointment(IDS[0]), privateValue: `secret ${PII}` },
    ]);
    const response = await test.handler(request());
    const text = await response.text();
    expect(response.status).toBe(503);
    expect(response.headers.get("content-type")).toBe(
      "application/json; charset=utf-8",
    );
    expect(text).not.toContain(PII);
    expect(JSON.parse(text)).toEqual({
      code: "SERVICE_UNAVAILABLE",
      requestId: REQUEST_ID,
    });
    expect(response.headers.getSetCookie()).toHaveLength(2);
  });
});

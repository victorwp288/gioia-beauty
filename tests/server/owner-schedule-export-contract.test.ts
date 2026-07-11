import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import {
  OwnerScheduleExportContractError,
  createOwnerScheduleExportReadRequest,
} from "@/lib/server/database/ownerScheduleExportReadContract.ts";
import { createOwnerScheduleExportPage } from "@/lib/server/database/ownerScheduleExportResponseContract.ts";

import { cursorCodec } from "./pagination-cursor-fixture.ts";

const NOW = new Date("2035-01-15T12:00:00.000Z");
const IDS = [
  "11111111-1111-4111-8111-111111111111",
  "22222222-2222-4222-8222-222222222222",
  "33333333-3333-4333-8333-333333333333",
] as const;

function query(overrides: Record<string, unknown> = {}) {
  return {
    fromDate: "2035-02-01",
    toDate: "2035-02-28",
    format: "csv",
    includeNotes: false,
    pageSize: 2,
    ...overrides,
  };
}

function request(overrides: Record<string, unknown> = {}) {
  const result = createOwnerScheduleExportReadRequest({
    query: query(overrides),
    cursorCodec: cursorCodec(),
    now: NOW,
  });
  if (!result.ok) throw new Error("unexpected invalid cursor");
  return result.request;
}

function appointment(id: string, overrides: Record<string, unknown> = {}) {
  return {
    id,
    schemaVersion: 1,
    source: "admin",
    date: "2035-02-10",
    startMinutes: 600,
    serviceDurationMinutes: 60,
    bufferMinutes: 15,
    cancelledAt: null,
    cancelledBy: null,
    cancellationReason: null,
    version: 1,
    createdAt: "2035-01-10T08:00:00.000Z",
    updatedAt: "2035-01-10T08:00:00.000Z",
    kind: "appointment",
    status: "confirmed",
    serviceId: "massaggio-relax",
    variantId: "massaggio-relax-60",
    serviceNameSnapshot: "Massaggio relax",
    variantNameSnapshot: "60 minuti",
    priceCentsSnapshot: 6000,
    currencySnapshot: "EUR",
    clientName: "Cliente Test",
    clientEmail: "cliente@example.test",
    clientPhone: "+393331234567",
    clientNote: null,
    internalNote: null,
    ...overrides,
  };
}

function block(id: string, overrides: Record<string, unknown> = {}) {
  return {
    id,
    schemaVersion: 1,
    source: "admin",
    date: "2035-02-10",
    startMinutes: 720,
    serviceDurationMinutes: 30,
    bufferMinutes: 0,
    cancelledAt: null,
    cancelledBy: null,
    cancellationReason: null,
    version: 1,
    createdAt: "2035-01-10T08:00:00.000Z",
    updatedAt: "2035-01-10T08:00:00.000Z",
    kind: "block",
    status: "active",
    internalNote: null,
    ...overrides,
  };
}

describe("owner schedule export request contract", () => {
  it("creates an exact bounded keyset plan", () => {
    const plan = request();
    expect(plan).toMatchObject({
      fromDate: "2035-02-01",
      toDate: "2035-02-28",
      format: "csv",
      includeNotes: false,
      pageSize: 2,
      rowLimit: 3,
      after: null,
      order: ["date", "startMinutes", "id"],
    });
    expect(plan.filterFingerprint).toMatch(/^[a-f0-9]{64}$/);
    expect(Object.isFrozen(plan)).toBe(true);
  });

  it("rejects omitted defaults, surplus fields, and forged cursors", () => {
    for (const candidate of [
      { fromDate: "2035-02-01", toDate: "2035-02-28" },
      query({ surplus: true }),
    ]) {
      expect(() =>
        createOwnerScheduleExportReadRequest({
          query: candidate,
          cursorCodec: cursorCodec(),
          now: NOW,
        }),
      ).toThrow(OwnerScheduleExportContractError);
    }
    expect(
      createOwnerScheduleExportReadRequest({
        query: query({
          cursor: "c1-key.e30.AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA",
        }),
        cursorCodec: cursorCodec(),
        now: NOW,
      }),
    ).toEqual({ ok: false, code: "INVALID_CURSOR" });
  });

  it("binds cursors to notes, page size, and range", () => {
    const codec = cursorCodec();
    const first = createOwnerScheduleExportReadRequest({
      query: query(),
      cursorCodec: codec,
      now: NOW,
    });
    if (!first.ok) throw new Error();
    const token = codec.issue({
      position: {
        scope: "schedule.export",
        date: "2035-02-10",
        startMinutes: 600,
        id: IDS[0],
      },
      filterFingerprint: first.request.filterFingerprint,
      pageSize: 2,
      now: NOW,
    });
    const continued = createOwnerScheduleExportReadRequest({
      query: query({ cursor: token }),
      cursorCodec: codec,
      now: NOW,
    });
    expect(continued).toMatchObject({
      ok: true,
      request: { after: { date: "2035-02-10", startMinutes: 600, id: IDS[0] } },
    });
    for (const changed of [
      query({ cursor: token, includeNotes: true }),
      query({ cursor: token, pageSize: 3 }),
      query({ cursor: token, toDate: "2035-02-27" }),
    ]) {
      expect(
        createOwnerScheduleExportReadRequest({
          query: changed,
          cursorCodec: codec,
          now: NOW,
        }),
      ).toEqual({ ok: false, code: "INVALID_CURSOR" });
    }
  });
});

describe("owner schedule export response contract", () => {
  it("renders a bounded UTF-8 CSV page and issues the next cursor", () => {
    const codec = cursorCodec();
    const planResult = createOwnerScheduleExportReadRequest({
      query: query(),
      cursorCodec: codec,
      now: NOW,
    });
    if (!planResult.ok) throw new Error();
    const page = createOwnerScheduleExportPage({
      request: planResult.request,
      rows: [
        appointment(IDS[0]),
        block(IDS[1]),
        appointment(IDS[2], { date: "2035-02-11" }),
      ],
      cursorCodec: codec,
      now: NOW,
    });
    expect(page.rowCount).toBe(2);
    expect(page.nextCursor).toMatch(/^c1-/);
    expect(page.filename).toBe(
      "gioia-beauty-schedule-2035-02-01_to_2035-02-28.csv",
    );
    expect(page.csv.startsWith('\uFEFF"id","schema_version"')).toBe(true);
    expect(page.csv).toContain('"10:00",60,15,"11:15"');
    expect(page.csv).toContain('"cliente@example.test"');
    expect(page.csv).not.toContain("client_note");
    expect(page.csv.endsWith("\r\n")).toBe(true);
    expect(page.csv.split("\r\n")).toHaveLength(4);
  });

  it("includes notes only when requested and neutralizes spreadsheet formulas", () => {
    const codec = cursorCodec();
    const planResult = createOwnerScheduleExportReadRequest({
      query: query({ includeNotes: true }),
      cursorCodec: codec,
      now: NOW,
    });
    if (!planResult.ok) throw new Error();
    const page = createOwnerScheduleExportPage({
      request: planResult.request,
      rows: [
        appointment(IDS[0], {
          clientName: '=HYPERLINK("https://attacker.test")',
          clientPhone: "+391234567",
          clientNote: "riga uno,\nriga due",
          internalNote: "@SUM(1,1)",
        }),
      ],
      cursorCodec: codec,
      now: NOW,
    });
    expect(page.csv).toContain(
      '"client_note","internal_note","cancellation_reason"',
    );
    expect(page.csv).toContain('"\'=HYPERLINK(""https://attacker.test"")"');
    expect(page.csv).toContain('"\'+391234567"');
    expect(page.csv).toContain('"\'@SUM(1,1)"');
    expect(page.csv).toContain('"riga uno,\nriga due"');
  });

  it("requires note projection to null when notes are excluded", () => {
    expect(() =>
      createOwnerScheduleExportPage({
        request: request(),
        rows: [appointment(IDS[0], { clientNote: "sensitive" })],
        cursorCodec: cursorCodec(),
        now: NOW,
      }),
    ).toThrow(OwnerScheduleExportContractError);
  });

  it("rejects forged plans, surplus rows, out-of-range rows, and bad ordering", () => {
    const plan = request();
    const cases = [
      [appointment(IDS[0], { extra: true })],
      [appointment(IDS[0], { date: "2035-03-01" })],
      [block(IDS[1]), appointment(IDS[0])],
      [
        appointment(IDS[0]),
        block(IDS[1]),
        appointment(IDS[2], { date: "2035-02-11" }),
        appointment("44444444-4444-4444-8444-444444444444", {
          date: "2035-02-12",
        }),
      ],
    ];
    for (const rows of cases) {
      expect(() =>
        createOwnerScheduleExportPage({
          request: plan,
          rows,
          cursorCodec: cursorCodec(),
          now: NOW,
        }),
      ).toThrow(OwnerScheduleExportContractError);
    }
    expect(() =>
      createOwnerScheduleExportPage({
        request: {
          ...plan,
          rowLimit: 500,
        },
        rows: [],
        cursorCodec: cursorCodec(),
        now: NOW,
      }),
    ).toThrow(OwnerScheduleExportContractError);
  });
});

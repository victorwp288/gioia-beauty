import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import {
  createOwnerScheduleListReadRequest,
  OwnerScheduleReadContractError,
} from "@/lib/server/database/ownerScheduleReadContract.ts";
import { createOwnerScheduleListResponse } from "@/lib/server/database/ownerScheduleListResponseContract.ts";
import {
  createOwnerScheduleCountReadRequest,
  createOwnerScheduleCountResponse,
} from "@/lib/server/database/ownerScheduleCountReadContract.ts";

import { NOW, cursorCodec } from "./pagination-cursor-fixture.ts";

const IDS = [
  "11111111-1111-4111-8111-111111111111",
  "22222222-2222-4222-8222-222222222222",
  "33333333-3333-4333-8333-333333333333",
] as const;

function appointment(
  id: string,
  overrides: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    id,
    schemaVersion: 1,
    source: "admin",
    date: "2026-07-10",
    startMinutes: 600,
    serviceDurationMinutes: 60,
    bufferMinutes: 0,
    cancelledAt: null,
    cancelledBy: null,
    cancellationReason: null,
    version: 1,
    createdAt: "2026-07-10T08:00:00.000Z",
    updatedAt: "2026-07-10T08:00:00.000Z",
    kind: "appointment",
    status: "confirmed",
    serviceId: "massaggio-relax",
    variantId: "massaggio-relax-60",
    serviceNameSnapshot: "Massaggio relax",
    variantNameSnapshot: "60 minuti",
    priceCentsSnapshot: 6000,
    currencySnapshot: "EUR",
    clientName: "Maria Rossi",
    clientEmail: "maria@example.com",
    clientPhone: "+393331234567",
    clientNote: null,
    internalNote: null,
    ...overrides,
  };
}

function block(
  id: string,
  overrides: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    id,
    schemaVersion: 1,
    source: "admin",
    date: "2026-07-10",
    startMinutes: 600,
    serviceDurationMinutes: 60,
    bufferMinutes: 0,
    cancelledAt: null,
    cancelledBy: null,
    cancellationReason: null,
    version: 1,
    createdAt: "2026-07-10T08:00:00.000Z",
    updatedAt: "2026-07-10T08:00:00.000Z",
    kind: "block",
    status: "active",
    internalNote: "Pausa",
    ...overrides,
  };
}

function listRequest(
  overrides: Record<string, unknown> = {},
  codec = cursorCodec(),
) {
  const result = createOwnerScheduleListReadRequest({
    query: {
      fromDate: "2026-07-01",
      toDate: "2026-07-31",
      pageSize: 2,
      ...overrides,
    },
    cursorCodec: codec,
    now: NOW,
  });
  if (!result.ok) throw new Error("expected a valid request");
  return { request: result.request, codec };
}

describe("owner schedule list read contract", () => {
  it("materializes canonical bounded source arguments", () => {
    const { request } = listRequest({
      kind: "appointment",
      statuses: ["completed", "confirmed"],
      pageSize: 100,
    });
    expect(request).toMatchObject({
      fromDate: "2026-07-01",
      toDate: "2026-07-31",
      kind: "appointment",
      statuses: ["completed", "confirmed"],
      pageSize: 100,
      rowLimit: 101,
      after: null,
      order: ["date", "startMinutes", "id"],
    });
    expect(request.filterFingerprint).toMatch(/^[a-f0-9]{64}$/);
    expect(Object.isFrozen(request)).toBe(true);
    expect(Object.isFrozen(request.statuses)).toBe(true);
  });

  it("rejects a cursor unless scope, filters, page size, signature, and time bind", () => {
    const codec = cursorCodec();
    const first = listRequest({}, codec);
    const token = codec.issue({
      position: {
        scope: "schedule.list",
        date: "2026-07-10",
        startMinutes: 600,
        id: IDS[0],
      },
      filterFingerprint: first.request.filterFingerprint,
      pageSize: 2,
      now: NOW,
    });
    const valid = createOwnerScheduleListReadRequest({
      query: {
        fromDate: "2026-07-01",
        toDate: "2026-07-31",
        pageSize: 2,
        cursor: token,
      },
      cursorCodec: codec,
      now: NOW,
    });
    expect(valid).toMatchObject({
      ok: true,
      request: { after: { id: IDS[0] } },
    });
    for (const query of [
      {
        fromDate: "2026-07-02",
        toDate: "2026-07-31",
        pageSize: 2,
        cursor: token,
      },
      {
        fromDate: "2026-07-01",
        toDate: "2026-07-31",
        pageSize: 3,
        cursor: token,
      },
      {
        fromDate: "2026-07-01",
        toDate: "2026-07-31",
        pageSize: 2,
        cursor: `${token.slice(0, -1)}A`,
      },
    ]) {
      expect(
        createOwnerScheduleListReadRequest({
          query,
          cursorCodec: codec,
          now: NOW,
        }),
      ).toEqual({ ok: false, code: "INVALID_CURSOR" });
    }
  });

  it("returns one bounded page and issues continuation from the last emitted row", () => {
    const { request, codec } = listRequest();
    const response = createOwnerScheduleListResponse({
      request,
      rows: [
        appointment(IDS[0]),
        appointment(IDS[1], { startMinutes: 660 }),
        appointment(IDS[2], { startMinutes: 720 }),
      ],
      cursorCodec: codec,
      now: NOW,
    });
    expect(response.items.map((item) => item.id)).toEqual(IDS.slice(0, 2));
    expect(response.nextCursor).not.toBeNull();
    expect(Object.isFrozen(response)).toBe(true);
    expect(Object.isFrozen(response.items)).toBe(true);
    expect(response.items.every(Object.isFrozen)).toBe(true);
    expect(
      codec.verify({
        token: response.nextCursor,
        expectedScope: "schedule.list",
        filterFingerprint: request.filterFingerprint,
        pageSize: request.pageSize,
        now: NOW,
      }),
    ).toMatchObject({ ok: true, cursor: { id: IDS[1] } });
  });

  it("does not invent a cursor without a lookahead row", () => {
    const { request, codec } = listRequest();
    expect(
      createOwnerScheduleListResponse({
        request,
        rows: [appointment(IDS[0]), appointment(IDS[1], { startMinutes: 660 })],
        cursorCodec: codec,
        now: NOW,
      }).nextCursor,
    ).toBeNull();
  });

  it("accepts the exact active-block discriminant and rejects appointment keys", () => {
    const { request, codec } = listRequest({
      kind: "block",
      statuses: ["active"],
    });
    expect(
      createOwnerScheduleListResponse({
        request,
        rows: [block(IDS[0])],
        cursorCodec: codec,
        now: NOW,
      }).items,
    ).toMatchObject([{ id: IDS[0], kind: "block", status: "active" }]);
    expect(() =>
      createOwnerScheduleListResponse({
        request,
        rows: [block(IDS[0], { serviceId: "massaggio-relax" })],
        cursorCodec: codec,
        now: NOW,
      }),
    ).toThrow(OwnerScheduleReadContractError);
  });

  it("collapses cursor issuance failure to the fixed contract error", () => {
    const { request } = listRequest();
    expect(() =>
      createOwnerScheduleListResponse({
        request,
        rows: [
          appointment(IDS[0]),
          appointment(IDS[1], { startMinutes: 660 }),
          appointment(IDS[2], { startMinutes: 720 }),
        ],
        cursorCodec: {
          issue() {
            throw new Error("secret configuration detail");
          },
          verify() {
            throw new Error("must not be reached");
          },
        },
        now: NOW,
      }),
    ).toThrow(OwnerScheduleReadContractError);
  });

  it("rejects a freshly issued cursor whose authenticated position is wrong", () => {
    const codec = cursorCodec();
    const { request } = listRequest({}, codec);
    const wrongToken = codec.issue({
      position: {
        scope: "schedule.list",
        date: "2026-07-10",
        startMinutes: 600,
        id: IDS[0],
      },
      filterFingerprint: request.filterFingerprint,
      pageSize: request.pageSize,
      now: NOW,
    });
    expect(() =>
      createOwnerScheduleListResponse({
        request,
        rows: [
          appointment(IDS[0]),
          appointment(IDS[1], { startMinutes: 660 }),
          appointment(IDS[2], { startMinutes: 720 }),
        ],
        cursorCodec: {
          issue: () => wrongToken,
          verify: (input) => codec.verify(input),
        },
        now: NOW,
      }),
    ).toThrow(OwnerScheduleReadContractError);
  });

  it("fails closed on excessive, unordered, duplicate, out-of-filter, and noncanonical rows", () => {
    const { request, codec } = listRequest({
      kind: "appointment",
      statuses: ["confirmed"],
    });
    const cases = [
      [
        appointment(IDS[0]),
        appointment(IDS[1], { startMinutes: 660 }),
        appointment(IDS[2], { startMinutes: 720 }),
        appointment("44444444-4444-4444-8444-444444444444", {
          startMinutes: 780,
        }),
      ],
      [appointment(IDS[1], { startMinutes: 660 }), appointment(IDS[0])],
      [appointment(IDS[0]), appointment(IDS[0])],
      [appointment(IDS[0], { date: "2026-08-01" })],
      [appointment(IDS[0], { status: "completed" })],
      [appointment(IDS[0], { clientEmail: " MARIA@EXAMPLE.COM " })],
      [new Proxy(appointment(IDS[0]), {})],
      [
        (() => {
          const row = appointment(IDS[0]);
          delete row.clientNote;
          return row;
        })(),
      ],
    ];
    for (const rows of cases) {
      expect(() =>
        createOwnerScheduleListResponse({
          request,
          rows,
          cursorCodec: codec,
          now: NOW,
        }),
      ).toThrow(OwnerScheduleReadContractError);
    }
  });

  it("rejects rows at or before an authenticated continuation", () => {
    const codec = cursorCodec();
    const first = listRequest({}, codec).request;
    const cursor = codec.issue({
      position: {
        scope: "schedule.list",
        date: "2026-07-10",
        startMinutes: 660,
        id: IDS[1],
      },
      filterFingerprint: first.filterFingerprint,
      pageSize: 2,
      now: NOW,
    });
    const { request } = listRequest({ cursor }, codec);
    expect(() =>
      createOwnerScheduleListResponse({
        request,
        rows: [appointment(IDS[0])],
        cursorCodec: codec,
        now: NOW,
      }),
    ).toThrow(OwnerScheduleReadContractError);
  });
});

describe("owner schedule count read contract", () => {
  it("materializes filters and creates one reconciled PII-free response", () => {
    const request = createOwnerScheduleCountReadRequest({
      fromDate: "2026-07-01",
      toDate: "2026-07-31",
      statuses: ["active", "confirmed"],
    });
    expect(request).toEqual({
      fromDate: "2026-07-01",
      toDate: "2026-07-31",
      kind: null,
      statuses: ["active", "confirmed"],
      rowLimit: 7,
    });
    expect(
      createOwnerScheduleCountResponse(request, [
        { kind: "appointment", status: "confirmed", count: 2 },
        { kind: "block", status: "active", count: 1 },
      ]),
    ).toEqual({
      fromDate: "2026-07-01",
      toDate: "2026-07-31",
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
  });

  it("zero-fills empty groups, combines cancelled kinds, and maps no_show", () => {
    const emptyRequest = createOwnerScheduleCountReadRequest({
      fromDate: "2026-07-01",
      toDate: "2026-07-31",
    });
    expect(createOwnerScheduleCountResponse(emptyRequest, [])).toMatchObject({
      total: 0,
      byKind: { appointment: 0, block: 0 },
      byStatus: {
        confirmed: 0,
        completed: 0,
        cancelled: 0,
        noShow: 0,
        active: 0,
      },
    });
    const response = createOwnerScheduleCountResponse(emptyRequest, [
      { kind: "appointment", status: "cancelled", count: 2 },
      { kind: "block", status: "cancelled", count: 3 },
      { kind: "appointment", status: "no_show", count: 4 },
    ]);
    expect(response).toMatchObject({
      total: 9,
      byKind: { appointment: 6, block: 3 },
      byStatus: { cancelled: 5, noShow: 4 },
    });
    expect(Object.isFrozen(response)).toBe(true);
    expect(Object.isFrozen(response.byKind)).toBe(true);
    expect(Object.isFrozen(response.byStatus)).toBe(true);
  });

  it("rejects mismatches, filtered dimensions, extra keys, and forged requests", () => {
    const request = createOwnerScheduleCountReadRequest({
      fromDate: "2026-07-01",
      toDate: "2026-07-31",
      kind: "appointment",
      statuses: ["confirmed"],
    });
    const valid = [{ kind: "appointment", status: "confirmed", count: 2 }];
    for (const groups of [
      [...valid, { kind: "appointment", status: "confirmed", count: 1 }],
      [{ kind: "block", status: "active", count: 1 }],
      [{ kind: "appointment", status: "completed", count: 1 }],
      [{ kind: "appointment", status: "confirmed", count: 0 }],
      [{ kind: "appointment", status: "confirmed", count: 2 ** 31 }],
      [{ kind: "appointment", status: "confirmed", count: 1, email: "x" }],
      [
        {
          kind: "appointment",
          status: { toString: () => void 0 },
          count: 1,
        },
      ],
      Array.from({ length: 7 }, (_, index) => ({
        kind: "appointment",
        status: "confirmed",
        count: index + 1,
      })),
    ]) {
      expect(() => createOwnerScheduleCountResponse(request, groups)).toThrow(
        OwnerScheduleReadContractError,
      );
    }
    expect(() =>
      createOwnerScheduleCountResponse(
        {
          fromDate: "2026-07-01",
          toDate: "2026-07-31",
          kind: null,
          statuses: [],
          rowLimit: 7,
        },
        valid,
      ),
    ).toThrow(OwnerScheduleReadContractError);
  });

  it("rejects proxy and accessor query objects before reading their values", () => {
    const getter = vi.fn(() => {
      throw new Error("getter detail");
    });
    const query = {} as Record<string, unknown>;
    Object.defineProperty(query, "fromDate", {
      enumerable: true,
      get: getter,
    });
    Object.defineProperty(query, "toDate", {
      enumerable: true,
      value: "2026-07-31",
    });
    expect(() => createOwnerScheduleCountReadRequest(query)).toThrow(
      OwnerScheduleReadContractError,
    );
    expect(getter).not.toHaveBeenCalled();
    expect(() =>
      createOwnerScheduleListReadRequest({
        query: new Proxy({ fromDate: "2026-07-01", toDate: "2026-07-31" }, {}),
        cursorCodec: cursorCodec(),
        now: NOW,
      }),
    ).toThrow(OwnerScheduleReadContractError);
    const statusGetter = vi.fn(() => {
      throw new Error("nested getter detail");
    });
    const statuses: unknown[] = [];
    Object.defineProperty(statuses, "0", {
      enumerable: true,
      get: statusGetter,
    });
    statuses.length = 1;
    for (const create of [
      () =>
        createOwnerScheduleCountReadRequest({
          fromDate: "2026-07-01",
          toDate: "2026-07-31",
          statuses,
        }),
      () =>
        createOwnerScheduleListReadRequest({
          query: {
            fromDate: "2026-07-01",
            toDate: "2026-07-31",
            statuses,
          },
          cursorCodec: cursorCodec(),
          now: NOW,
        }),
    ]) {
      expect(create).toThrow(OwnerScheduleReadContractError);
    }
    expect(statusGetter).not.toHaveBeenCalled();
  });
});

import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { createOwnerVacationListResponse } from "@/lib/server/database/ownerVacationListResponseContract.ts";
import {
  createOwnerVacationListReadRequest,
  OwnerVacationReadContractError,
} from "@/lib/server/database/ownerVacationReadContract.ts";

import { NOW, cursorCodec } from "./pagination-cursor-fixture.ts";

const IDS = [
  "11111111-1111-4111-8111-111111111111",
  "22222222-2222-4222-8222-222222222222",
  "33333333-3333-4333-8333-333333333333",
] as const;

function vacation(
  id: string,
  overrides: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    id,
    schemaVersion: 1,
    startDate: "2026-07-10",
    endDate: "2026-07-12",
    status: "active",
    reason: "Chiusura estiva",
    source: "admin",
    cancelledAt: null,
    cancelledBy: null,
    version: 1,
    createdAt: "2026-07-01T08:00:00.000Z",
    updatedAt: "2026-07-01T08:00:00.000Z",
    ...overrides,
  };
}

function listRequest(
  overrides: Record<string, unknown> = {},
  codec = cursorCodec(),
) {
  const result = createOwnerVacationListReadRequest({
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

describe("owner vacation list read contract", () => {
  it("materializes one capability-issued bounded overlap request", () => {
    const { request } = listRequest({ pageSize: 100 });
    expect(request).toMatchObject({
      fromDate: "2026-07-01",
      toDate: "2026-07-31",
      pageSize: 100,
      rowLimit: 101,
      after: null,
      order: ["startDate", "id"],
    });
    expect(request.filterFingerprint).toMatch(/^[a-f0-9]{64}$/);
    expect(Object.isFrozen(request)).toBe(true);
  });

  it("rejects nonexact queries and refuses caller-forged request objects", () => {
    for (const query of [
      {
        fromDate: "2026-07-01",
        toDate: "2026-07-31",
        pageSize: 2,
        extra: "private",
      },
      {
        fromDate: "2026-07-01",
        toDate: "2026-07-31",
        pageSize: "2",
      },
      {
        fromDate: "2026-07-01",
        toDate: "2027-07-02",
        pageSize: 2,
      },
      new Proxy(
        { fromDate: "2026-07-01", toDate: "2026-07-31", pageSize: 2 },
        {},
      ),
    ]) {
      expect(() =>
        createOwnerVacationListReadRequest({
          query,
          cursorCodec: cursorCodec(),
          now: NOW,
        }),
      ).toThrow(OwnerVacationReadContractError);
    }

    const { request, codec } = listRequest();
    expect(() =>
      createOwnerVacationListResponse({
        request: { ...request },
        rows: [],
        cursorCodec: codec,
        now: NOW,
      }),
    ).toThrow(OwnerVacationReadContractError);
  });

  it("binds cursor scope, filters, page size, signature, and time", () => {
    const codec = cursorCodec();
    const first = listRequest({}, codec);
    const token = codec.issue({
      position: {
        scope: "vacations.list",
        startDate: "2026-07-10",
        id: IDS[0],
      },
      filterFingerprint: first.request.filterFingerprint,
      pageSize: 2,
      now: NOW,
    });
    expect(
      createOwnerVacationListReadRequest({
        query: {
          fromDate: "2026-07-01",
          toDate: "2026-07-31",
          pageSize: 2,
          cursor: token,
        },
        cursorCodec: codec,
        now: NOW,
      }),
    ).toMatchObject({ ok: true, request: { after: { id: IDS[0] } } });

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
        createOwnerVacationListReadRequest({
          query,
          cursorCodec: codec,
          now: NOW,
        }),
      ).toEqual({ ok: false, code: "INVALID_CURSOR" });
    }
  });

  it("includes vacations that begin before the requested range but overlap it", () => {
    const { request, codec } = listRequest();
    const response = createOwnerVacationListResponse({
      request,
      rows: [
        vacation(IDS[0], {
          startDate: "2026-06-28",
          endDate: "2026-07-02",
        }),
      ],
      cursorCodec: codec,
      now: NOW,
    });
    expect(response.items.map((item) => item.id)).toEqual([IDS[0]]);
  });

  it("returns one bounded page and issues continuation from the last emitted row", () => {
    const { request, codec } = listRequest();
    const response = createOwnerVacationListResponse({
      request,
      rows: [
        vacation(IDS[0]),
        vacation(IDS[1]),
        vacation(IDS[2], { startDate: "2026-07-20", endDate: "2026-07-21" }),
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
        expectedScope: "vacations.list",
        filterFingerprint: request.filterFingerprint,
        pageSize: request.pageSize,
        now: NOW,
      }),
    ).toMatchObject({ ok: true, cursor: { id: IDS[1] } });
  });

  it("does not invent a cursor without a lookahead row", () => {
    const { request, codec } = listRequest();
    expect(
      createOwnerVacationListResponse({
        request,
        rows: [vacation(IDS[0]), vacation(IDS[1])],
        cursorCodec: codec,
        now: NOW,
      }).nextCursor,
    ).toBeNull();
  });

  it("accepts canonical cancelled admin and migrated DTOs", () => {
    const { request, codec } = listRequest();
    const response = createOwnerVacationListResponse({
      request,
      rows: [
        vacation(IDS[0], {
          status: "cancelled",
          cancelledAt: "2026-07-02T08:00:00.000Z",
          cancelledBy: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
          version: 2,
          updatedAt: "2026-07-02T08:00:00.000Z",
        }),
        vacation(IDS[1], {
          source: "migration",
          status: "cancelled",
          cancelledAt: "2026-07-02T08:00:00.000Z",
          cancelledBy: null,
          version: 2,
          updatedAt: "2026-07-02T08:00:00.000Z",
        }),
      ],
      cursorCodec: codec,
      now: NOW,
    });
    expect(response.items).toHaveLength(2);
  });

  it("fails closed on excessive, unordered, duplicate, disjoint, and noncanonical rows", () => {
    const { request, codec } = listRequest();
    const fourthId = "44444444-4444-4444-8444-444444444444";
    const cases = [
      [
        vacation(IDS[0]),
        vacation(IDS[1]),
        vacation(IDS[2]),
        vacation(fourthId),
      ],
      [vacation(IDS[1]), vacation(IDS[0])],
      [vacation(IDS[0]), vacation(IDS[0])],
      [vacation(IDS[0], { startDate: "2026-08-01", endDate: "2026-08-02" })],
      [vacation(IDS[0], { endDate: "2026-06-30" })],
      [vacation(IDS[0], { reason: " Chiusura estiva " })],
      [
        vacation(IDS[0], {
          id: "AAAAAAAA-AAAA-4AAA-8AAA-AAAAAAAAAAAA",
        }),
      ],
      [vacation(IDS[0], { privateValue: "private" })],
      [new Proxy(vacation(IDS[0]), {})],
      [vacation(IDS[0], { status: "cancelled" })],
    ];
    for (const rows of cases) {
      expect(() =>
        createOwnerVacationListResponse({
          request,
          rows,
          cursorCodec: codec,
          now: NOW,
        }),
      ).toThrow(OwnerVacationReadContractError);
    }
  });

  it("rejects rows at or before an authenticated continuation", () => {
    const codec = cursorCodec();
    const first = listRequest({}, codec).request;
    const cursor = codec.issue({
      position: {
        scope: "vacations.list",
        startDate: "2026-07-10",
        id: IDS[1],
      },
      filterFingerprint: first.filterFingerprint,
      pageSize: 2,
      now: NOW,
    });
    const { request } = listRequest({ cursor }, codec);
    expect(() =>
      createOwnerVacationListResponse({
        request,
        rows: [vacation(IDS[0])],
        cursorCodec: codec,
        now: NOW,
      }),
    ).toThrow(OwnerVacationReadContractError);
  });

  it("collapses malformed codec success and cursor issuance faults", () => {
    expect(() =>
      createOwnerVacationListReadRequest({
        query: {
          fromDate: "2026-07-01",
          toDate: "2026-07-31",
          pageSize: 2,
          cursor: `c1-key.e30.${"A".repeat(43)}`,
        },
        cursorCodec: {
          verify: () => ({ ok: true, cursor: { private: true } }) as never,
        },
        now: NOW,
      }),
    ).toThrow(OwnerVacationReadContractError);

    const { request } = listRequest();
    expect(() =>
      createOwnerVacationListResponse({
        request,
        rows: [vacation(IDS[0]), vacation(IDS[1]), vacation(IDS[2])],
        cursorCodec: {
          issue() {
            throw new Error("private configuration detail");
          },
          verify() {
            throw new Error("must not be reached");
          },
        },
        now: NOW,
      }),
    ).toThrow(OwnerVacationReadContractError);
  });
});

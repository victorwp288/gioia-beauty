import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { AdminOutboxDtoSchema } from "@/lib/domain/schemas/index.ts";
import {
  OwnerOutboxReadContractError,
  createOwnerOutboxListReadRequest,
} from "@/lib/server/database/ownerOutboxReadContract.ts";
import { createOwnerOutboxListResponse } from "@/lib/server/database/ownerOutboxListResponseContract.ts";

import { NOW, cursorCodec } from "./pagination-cursor-fixture.ts";

const IDS = [
  "11111111-1111-4111-8111-111111111111",
  "22222222-2222-4222-8222-222222222222",
  "33333333-3333-4333-8333-333333333333",
] as const;

function item(
  id: string,
  overrides: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    id,
    aggregateKind: "schedule_entry",
    aggregateId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
    aggregateVersion: 1,
    recipientKind: "customer",
    recipientAddress: "cliente@example.test",
    templateKind: "booking_customer",
    status: "pending",
    providerMessageId: null,
    attemptCount: 0,
    nextAttemptAt: "2035-02-01T08:00:00.000Z",
    lastErrorCode: null,
    sentAt: null,
    version: 1,
    createdAt: "2035-02-01T08:00:00.123Z",
    updatedAt: "2035-02-01T08:00:00.123Z",
    ...overrides,
  };
}

function row(
  id: string,
  cursorCreatedAt: string,
  overrides: Record<string, unknown> = {},
) {
  return { cursorCreatedAt, item: item(id, overrides) };
}

function listRequest(
  overrides: Record<string, unknown> = {},
  codec = cursorCodec(),
) {
  const result = createOwnerOutboxListReadRequest({
    query: { pageSize: 2, ...overrides },
    cursorCodec: codec,
    now: NOW,
  });
  if (!result.ok) throw new Error("expected valid request");
  return { request: result.request, codec };
}

describe("owner outbox list read contract", () => {
  it("materializes one exact newest-first bounded plan", () => {
    const { request } = listRequest({
      statuses: ["sent", "failed", "pending"],
      pageSize: 100,
    });
    expect(request).toMatchObject({
      statuses: ["failed", "pending", "sent"],
      pageSize: 100,
      rowLimit: 101,
      after: null,
      order: [
        { field: "createdAt", direction: "desc" },
        { field: "id", direction: "desc" },
      ],
    });
    expect(request.filterFingerprint).toMatch(/^[a-f0-9]{64}$/);
    expect(Object.isFrozen(request)).toBe(true);
    expect(Object.isFrozen(request.statuses)).toBe(true);
  });

  it("binds the authenticated cursor to filters, page size, and microsecond position", () => {
    const codec = cursorCodec();
    const first = listRequest({}, codec);
    const token = codec.issue({
      position: {
        scope: "outbox.list",
        createdAt: "2035-02-01T08:00:00.123456Z",
        id: IDS[0],
      },
      filterFingerprint: first.request.filterFingerprint,
      pageSize: 2,
      now: NOW,
    });
    expect(
      createOwnerOutboxListReadRequest({
        query: { pageSize: 2, cursor: token },
        cursorCodec: codec,
        now: NOW,
      }),
    ).toMatchObject({
      ok: true,
      request: {
        after: {
          createdAt: "2035-02-01T08:00:00.123456Z",
          id: IDS[0],
        },
      },
    });
    for (const query of [
      { pageSize: 3, cursor: token },
      { pageSize: 2, statuses: ["pending"], cursor: token },
      { pageSize: 2, cursor: `${token.slice(0, -1)}A` },
    ]) {
      expect(
        createOwnerOutboxListReadRequest({
          query,
          cursorCodec: codec,
          now: NOW,
        }),
      ).toEqual({ ok: false, code: "INVALID_CURSOR" });
    }
  });

  it("returns one private DTO page and issues continuation from the last emitted microsecond", () => {
    const { request, codec } = listRequest();
    const response = createOwnerOutboxListResponse({
      request,
      rows: [
        row(IDS[2], "2035-02-01T08:00:00.123999Z"),
        row(IDS[1], "2035-02-01T08:00:00.123456Z"),
        row(IDS[0], "2035-02-01T08:00:00.123111Z"),
      ],
      cursorCodec: codec,
      now: NOW,
    });
    expect(response.items.map((entry) => entry.id)).toEqual([IDS[2], IDS[1]]);
    expect(response.nextCursor).not.toBeNull();
    expect(
      codec.verify({
        token: response.nextCursor,
        expectedScope: "outbox.list",
        filterFingerprint: request.filterFingerprint,
        pageSize: request.pageSize,
        now: NOW,
      }),
    ).toMatchObject({
      ok: true,
      cursor: {
        createdAt: "2035-02-01T08:00:00.123456Z",
        id: IDS[1],
      },
    });
    expect(Object.isFrozen(response)).toBe(true);
    expect(Object.isFrozen(response.items)).toBe(true);
  });

  it("paginates equal microsecond timestamps by descending UUID after-boundary", () => {
    const codec = cursorCodec();
    const first = listRequest({}, codec);
    const firstPage = createOwnerOutboxListResponse({
      request: first.request,
      rows: [
        row(IDS[2], "2035-02-01T08:00:00.123456Z"),
        row(IDS[1], "2035-02-01T08:00:00.123456Z"),
        row(IDS[0], "2035-02-01T08:00:00.123456Z"),
      ],
      cursorCodec: codec,
      now: NOW,
    });
    const second = createOwnerOutboxListReadRequest({
      query: { pageSize: 2, cursor: firstPage.nextCursor },
      cursorCodec: codec,
      now: NOW,
    });
    if (!second.ok) throw new Error("expected valid continuation");
    expect(
      createOwnerOutboxListResponse({
        request: second.request,
        rows: [row(IDS[0], "2035-02-01T08:00:00.123456Z")],
        cursorCodec: codec,
        now: NOW,
      }).items.map((entry) => entry.id),
    ).toEqual([IDS[0]]);
    expect(() =>
      createOwnerOutboxListResponse({
        request: second.request,
        rows: [row(IDS[1], "2035-02-01T08:00:00.123456Z")],
        cursorCodec: codec,
        now: NOW,
      }),
    ).toThrow(OwnerOutboxReadContractError);
  });

  it("accepts every canonical delivery state and compatible subscriber snapshots", () => {
    const states = [
      {},
      { status: "sending", attemptCount: 1 },
      { status: "failed", attemptCount: 1, lastErrorCode: "SEND_FAILED" },
      {
        status: "dead_letter",
        attemptCount: 5,
        lastErrorCode: "SEND_FAILED",
      },
      {
        status: "sent",
        attemptCount: 1,
        providerMessageId: "provider-1",
        sentAt: "2035-02-01T08:01:00.000Z",
      },
      {
        status: "bounced",
        attemptCount: 1,
        providerMessageId: "provider-1",
        lastErrorCode: "EMAIL_BOUNCED",
        sentAt: "2035-02-01T08:01:00.000Z",
      },
      {
        status: "complained",
        attemptCount: 1,
        providerMessageId: "provider-1",
        lastErrorCode: "EMAIL_COMPLAINED",
        sentAt: "2035-02-01T08:01:00.000Z",
      },
      {
        aggregateKind: "subscriber",
        recipientKind: "subscriber",
        templateKind: "newsletter_confirmation",
      },
    ];
    for (const overrides of states) {
      expect(
        AdminOutboxDtoSchema.safeParse(item(IDS[0], overrides)).success,
      ).toBe(true);
    }
  });

  it("rejects incompatible snapshots and impossible delivery metadata", () => {
    for (const overrides of [
      { aggregateKind: "subscriber" },
      { recipientKind: "owner" },
      { templateKind: "newsletter_confirmation" },
      { status: "pending", attemptCount: 1 },
      { status: "sent", attemptCount: 1 },
      {
        status: "failed",
        attemptCount: 1,
        lastErrorCode: null,
      },
      {
        status: "sent",
        attemptCount: 1,
        providerMessageId: "provider-1",
        sentAt: "2035-01-01T00:00:00.000Z",
      },
      { updatedAt: "2035-01-01T00:00:00.000Z" },
    ]) {
      expect(
        AdminOutboxDtoSchema.safeParse(item(IDS[0], overrides)).success,
      ).toBe(false);
    }
  });

  it("rejects malformed, filtered, imprecise, unordered, duplicate, excessive, and forged rows", () => {
    const filtered = listRequest({ statuses: ["pending"] });
    const cases: unknown[] = [
      [row(IDS[0], "2035-02-01T08:00:00.123456Z", { extra: true })],
      [row(IDS[0], "2035-02-01T08:00:00.124456Z")],
      [
        row(IDS[0], "2035-02-01T08:00:00.123111Z"),
        row(IDS[1], "2035-02-01T08:00:00.123999Z"),
      ],
      [
        row(IDS[0], "2035-02-01T08:00:00.123456Z"),
        row(IDS[0], "2035-02-01T08:00:00.123456Z"),
      ],
      [
        row(IDS[0], "2035-02-01T08:00:00.123456Z", {
          status: "sent",
          attemptCount: 1,
          providerMessageId: "provider-1",
          sentAt: "2035-02-01T08:01:00.000Z",
        }),
      ],
      Array.from({ length: 4 }, (_, index) =>
        row(
          `00000000-0000-4000-8000-00000000000${3 - index}`,
          `2035-02-01T08:00:00.12${3 - index}000Z`,
          { createdAt: `2035-02-01T08:00:00.12${3 - index}Z` },
        ),
      ),
    ];
    for (const rows of cases) {
      expect(() =>
        createOwnerOutboxListResponse({
          request: filtered.request,
          rows,
          cursorCodec: filtered.codec,
          now: NOW,
        }),
      ).toThrow(OwnerOutboxReadContractError);
    }
    expect(() =>
      createOwnerOutboxListResponse({
        request: { ...filtered.request },
        rows: [],
        cursorCodec: filtered.codec,
        now: NOW,
      }),
    ).toThrow(OwnerOutboxReadContractError);
  });

  it("collapses cursor issuance collaborator faults", () => {
    const { request } = listRequest();
    expect(() =>
      createOwnerOutboxListResponse({
        request,
        rows: [
          row(IDS[2], "2035-02-01T08:00:00.123999Z"),
          row(IDS[1], "2035-02-01T08:00:00.123456Z"),
          row(IDS[0], "2035-02-01T08:00:00.123111Z"),
        ],
        cursorCodec: {
          issue() {
            throw new Error("private key detail");
          },
          verify() {
            throw new Error("must not leak");
          },
        },
        now: NOW,
      }),
    ).toThrow(OwnerOutboxReadContractError);
  });
});

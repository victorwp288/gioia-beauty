import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { parseSubscriberListSearchParams } from "@/lib/domain/schemas/index.ts";
import {
  createOwnerSubscriberListReadRequest,
  OwnerSubscriberReadContractError,
} from "@/lib/server/database/ownerSubscriberReadContract.ts";
import { createOwnerSubscriberListResponse } from "@/lib/server/database/ownerSubscriberListResponseContract.ts";

import { NOW, cursorCodec } from "./pagination-cursor-fixture.ts";

const IDS = [
  "33333333-3333-4333-8333-333333333333",
  "22222222-2222-4222-8222-222222222222",
  "11111111-1111-4111-8111-111111111111",
] as const;

function subscriber(
  id: string,
  cursorCreatedAt: string,
  overrides: Record<string, unknown> = {},
) {
  const createdAt = cursorCreatedAt.replace(/\.([0-9]{3})[0-9]{3}Z$/, ".$1Z");
  return {
    cursorCreatedAt,
    item: {
      id,
      schemaVersion: 1,
      email: `reader-${id[0]}@example.test`,
      status: "active",
      source: "public",
      consentAt: "2034-12-01T08:00:00.000Z",
      consentSource: "newsletter-form",
      consentPolicyVersion: "newsletter-consent-v1",
      confirmedAt: "2034-12-01T08:05:00.000Z",
      unsubscribedAt: null,
      version: 1,
      createdAt,
      updatedAt: createdAt,
      ...overrides,
    },
  };
}

function request(
  overrides: Record<string, unknown> = {},
  codec = cursorCodec(),
) {
  const result = createOwnerSubscriberListReadRequest({
    query: { pageSize: 2, ...overrides },
    cursorCodec: codec,
    now: NOW,
  });
  if (!result.ok) throw new Error("expected valid subscriber request");
  return { request: result.request, codec };
}

describe("owner subscriber list read contract", () => {
  it("materializes sorted filters, newest-first order, and one lookahead row", () => {
    const parsed = parseSubscriberListSearchParams(
      new URLSearchParams("status=pending&status=active&pageSize=100"),
    );
    const result = createOwnerSubscriberListReadRequest({
      query: parsed,
      cursorCodec: cursorCodec(),
      now: NOW,
    });
    expect(result).toMatchObject({
      ok: true,
      request: {
        statuses: ["active", "pending"],
        pageSize: 100,
        rowLimit: 101,
        after: null,
        order: [
          { field: "createdAt", direction: "desc" },
          { field: "id", direction: "desc" },
        ],
      },
    });
    if (!result.ok) throw new Error();
    expect(result.request.filterFingerprint).toMatch(/^[a-f0-9]{64}$/);
    expect(Object.isFrozen(result.request)).toBe(true);
    expect(Object.isFrozen(result.request.statuses)).toBe(true);
    expect(Object.isFrozen(result.request.order[0])).toBe(true);
  });

  it("accepts the parser's omitted statuses and applies default page size", () => {
    const parsed = parseSubscriberListSearchParams(new URLSearchParams());
    const result = createOwnerSubscriberListReadRequest({
      query: parsed,
      cursorCodec: cursorCodec(),
      now: NOW,
    });
    expect(result).toMatchObject({
      ok: true,
      request: { statuses: [], pageSize: 50, rowLimit: 51 },
    });
  });

  it("binds cursor scope, statuses, page size, signature, time, and position", () => {
    const codec = cursorCodec();
    const first = request({ statuses: ["active"] }, codec);
    const token = codec.issue({
      position: {
        scope: "subscribers.list",
        createdAt: "2034-12-20T10:00:00.123456Z",
        id: IDS[0],
      },
      filterFingerprint: first.request.filterFingerprint,
      pageSize: 2,
      now: NOW,
    });
    const valid = createOwnerSubscriberListReadRequest({
      query: { statuses: ["active"], pageSize: 2, cursor: token },
      cursorCodec: codec,
      now: NOW,
    });
    expect(valid).toMatchObject({
      ok: true,
      request: {
        after: {
          createdAt: "2034-12-20T10:00:00.123456Z",
          id: IDS[0],
        },
      },
    });
    for (const query of [
      { statuses: ["pending"], pageSize: 2, cursor: token },
      { statuses: ["active"], pageSize: 3, cursor: token },
      {
        statuses: ["active"],
        pageSize: 2,
        cursor: `${token.slice(0, -1)}A`,
      },
    ]) {
      expect(
        createOwnerSubscriberListReadRequest({
          query,
          cursorCodec: codec,
          now: NOW,
        }),
      ).toEqual({ ok: false, code: "INVALID_CURSOR" });
    }
  });

  it("preserves PostgreSQL microseconds in a continuation cursor", () => {
    const { request: plan, codec } = request();
    const response = createOwnerSubscriberListResponse({
      request: plan,
      rows: [
        subscriber(IDS[0], "2034-12-20T10:00:00.123999Z"),
        subscriber(IDS[1], "2034-12-20T10:00:00.123456Z"),
        subscriber(IDS[2], "2034-12-20T10:00:00.123111Z"),
      ],
      cursorCodec: codec,
      now: NOW,
    });
    expect(response.items.map((item) => item.id)).toEqual(IDS.slice(0, 2));
    expect(response.nextCursor).not.toBeNull();
    expect(
      codec.verify({
        token: response.nextCursor,
        expectedScope: "subscribers.list",
        filterFingerprint: plan.filterFingerprint,
        pageSize: 2,
        now: NOW,
      }),
    ).toMatchObject({
      ok: true,
      cursor: {
        createdAt: "2034-12-20T10:00:00.123456Z",
        id: IDS[1],
      },
    });
    expect(Object.isFrozen(response)).toBe(true);
    expect(Object.isFrozen(response.items)).toBe(true);
    expect(response.items.every(Object.isFrozen)).toBe(true);
  });

  it("uses descending UUID as the deterministic timestamp tie-breaker", () => {
    const { request: plan, codec } = request();
    const rows = IDS.map((id) => subscriber(id, "2034-12-20T10:00:00.123456Z"));
    expect(
      createOwnerSubscriberListResponse({
        request: plan,
        rows,
        cursorCodec: codec,
        now: NOW,
      }).items.map((item) => item.id),
    ).toEqual(IDS.slice(0, 2));
    expect(() =>
      createOwnerSubscriberListResponse({
        request: plan,
        rows: [rows[1], rows[0]],
        cursorCodec: codec,
        now: NOW,
      }),
    ).toThrow(OwnerSubscriberReadContractError);
  });

  it("does not invent a cursor without a validated lookahead", () => {
    const { request: plan, codec } = request();
    const response = createOwnerSubscriberListResponse({
      request: plan,
      rows: [
        subscriber(IDS[0], "2034-12-20T10:00:00.123999Z"),
        subscriber(IDS[1], "2034-12-20T10:00:00.123456Z"),
      ],
      cursorCodec: codec,
      now: NOW,
    });
    expect(response.nextCursor).toBeNull();
  });

  it("rejects status mismatch, cursor/DTO mismatch, noncanonical PII, and row overflow", () => {
    const { request: activePlan, codec } = request({ statuses: ["active"] });
    const valid = subscriber(IDS[0], "2034-12-20T10:00:00.123456Z");
    for (const rows of [
      [
        subscriber(IDS[0], "2034-12-20T10:00:00.123456Z", {
          status: "pending",
          confirmedAt: null,
        }),
      ],
      [{ ...valid, cursorCreatedAt: "2034-12-20T10:00:00.124456Z" }],
      [{ ...valid, item: { ...valid.item, email: " Reader@Example.test " } }],
      [{ ...valid, privateNote: "PII" }],
      Array.from({ length: activePlan.rowLimit + 1 }, () => valid),
    ]) {
      expect(() =>
        createOwnerSubscriberListResponse({
          request: activePlan,
          rows,
          cursorCodec: codec,
          now: NOW,
        }),
      ).toThrow(OwnerSubscriberReadContractError);
    }
  });

  it("rejects forged request plans and hostile query/cursor collaborator shapes", () => {
    const codec = cursorCodec();
    expect(() =>
      createOwnerSubscriberListReadRequest({
        query: { statuses: ["active", "active"] },
        cursorCodec: codec,
        now: NOW,
      }),
    ).toThrow();
    expect(() =>
      createOwnerSubscriberListReadRequest({
        query: new Proxy({}, {}),
        cursorCodec: codec,
        now: NOW,
      }),
    ).toThrow(OwnerSubscriberReadContractError);
    expect(() =>
      createOwnerSubscriberListResponse({
        request: {
          statuses: [],
          pageSize: 2,
          rowLimit: 3,
          after: null,
          order: [
            { field: "createdAt", direction: "desc" },
            { field: "id", direction: "desc" },
          ],
          filterFingerprint: "0".repeat(64),
        },
        rows: [],
        cursorCodec: codec,
        now: NOW,
      }),
    ).toThrow(OwnerSubscriberReadContractError);
  });
});

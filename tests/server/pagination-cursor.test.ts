import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import {
  PaginationCursorInputError,
  createPaginationCursorCodec,
  type PaginationCursorCodecConfiguration,
  type PaginationCursorKeyConfiguration,
} from "@/lib/server/paginationCursor.ts";

import {
  ENTITY_ID,
  FINGERPRINT,
  GOLDEN_TOKENS,
  INVALID,
  NOW,
  OTHER_FINGERPRINT,
  POSITIONS,
  PREVIOUS_KEY,
  PRIMARY_KEY,
  cursorCodec,
  issue,
  tokenPayload,
  verify,
} from "./pagination-cursor-fixture.ts";

describe("pagination cursor codec", () => {
  it("issues deterministic bounded tokens for every position family", () => {
    const cases = [
      [POSITIONS.scheduleList, 100],
      [POSITIONS.scheduleExport, 500],
      [POSITIONS.vacations, 100],
      [POSITIONS.subscribers, 100],
      [POSITIONS.outbox, 100],
    ] as const;

    for (const [position, pageSize] of cases) {
      const token = cursorCodec().issue({
        position,
        filterFingerprint: FINGERPRINT,
        pageSize,
        now: NOW,
      });
      expect(token).toBe(GOLDEN_TOKENS[position.scope]);
      expect(token).toMatch(
        /^c1-primary_1\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]{43}$/,
      );
      expect(token.length).toBeLessThanOrEqual(512);
      expect(
        cursorCodec().verify({
          token,
          expectedScope: position.scope,
          filterFingerprint: FINGERPRINT,
          pageSize,
          now: NOW,
        }),
      ).toMatchObject({ ok: true, cursor: position });
    }
  });

  it("binds scope, filters, and page size without authorizing a request", () => {
    const token = issue();
    expect(verify(token)).toMatchObject({
      ok: true,
      cursor: {
        version: 1,
        filterFingerprint: FINGERPRINT,
        pageSize: 50,
        ...POSITIONS.scheduleList,
      },
    });
    expect(verify(token, "schedule.export")).toEqual(INVALID);
    expect(verify(token, "schedule.list", 49)).toEqual(INVALID);
    expect(verify(token, "schedule.list", 50, NOW, OTHER_FINGERPRINT)).toEqual(
      INVALID,
    );
  });

  it("returns fresh immutable successes and one redacted immutable failure", () => {
    const token = issue();
    const first = verify(token);
    const second = verify(token);
    expect(first).toEqual(second);
    expect(first).not.toBe(second);
    expect(Object.isFrozen(first)).toBe(true);
    if (first.ok && second.ok) {
      expect(first.cursor).not.toBe(second.cursor);
      expect(Object.isFrozen(first.cursor)).toBe(true);
      expect(Reflect.set(first.cursor, "pageSize", 99)).toBe(false);
    }
    const invalid = verify("customer@example.com");
    expect(invalid).toEqual(INVALID);
    expect(invalid).toBe(verify("different-sensitive-value"));
    expect(Object.isFrozen(invalid)).toBe(true);
    expect(JSON.stringify(invalid)).not.toContain("customer@example.com");
  });

  it("uses only the active key and verifies retained rotation keys", () => {
    const oldIssuer = createPaginationCursorCodec({
      activeKeyId: PREVIOUS_KEY.id,
      keys: [PRIMARY_KEY, PREVIOUS_KEY],
    });
    const input = {
      position: POSITIONS.scheduleList,
      filterFingerprint: FINGERPRINT,
      pageSize: 50,
      now: NOW,
    };
    const oldToken = oldIssuer.issue(input);
    const rotating = createPaginationCursorCodec({
      activeKeyId: PRIMARY_KEY.id,
      keys: [PRIMARY_KEY, PREVIOUS_KEY],
    });

    expect(oldToken).toMatch(/^c1-previous_1\./);
    expect(rotating.issue(input)).toMatch(/^c1-primary_1\./);
    expect(
      rotating.verify({
        token: oldToken,
        expectedScope: "schedule.list",
        filterFingerprint: FINGERPRINT,
        pageSize: 50,
        now: NOW,
      }).ok,
    ).toBe(true);
    expect(verify(oldToken)).toEqual(INVALID);
  });

  it("copies key configuration before caller mutation", () => {
    const mutableKey: PaginationCursorKeyConfiguration = { ...PRIMARY_KEY };
    const keys: PaginationCursorKeyConfiguration[] = [mutableKey];
    const configuration: PaginationCursorCodecConfiguration = {
      activeKeyId: PRIMARY_KEY.id,
      keys,
    };
    const codec = createPaginationCursorCodec(configuration);
    mutableKey.id = "changed";
    mutableKey.secret = PREVIOUS_KEY.secret;
    configuration.activeKeyId = "changed";
    keys.push(PREVIOUS_KEY);

    expect(
      codec.issue({
        position: POSITIONS.scheduleList,
        filterFingerprint: FINGERPRINT,
        pageSize: 50,
        now: NOW,
      }),
    ).toBe(issue());
  });

  it("preserves PostgreSQL microseconds without a JavaScript Date round-trip", () => {
    const subscriber = cursorCodec().issue({
      position: POSITIONS.subscribers,
      filterFingerprint: FINGERPRINT,
      pageSize: 50,
      now: NOW,
    });
    const outbox = cursorCodec().issue({
      position: POSITIONS.outbox,
      filterFingerprint: FINGERPRINT,
      pageSize: 50,
      now: NOW,
    });

    expect(subscriber).not.toBe(outbox);
    expect(tokenPayload(subscriber).createdAt).toBe(
      "2026-07-10T11:59:59.123456Z",
    );
    expect(tokenPayload(outbox).createdAt).toBe("2026-07-10T11:59:59.123457Z");
  });

  it("expires exactly after fifteen minutes and allows 60 seconds of skew", () => {
    const token = issue();
    expect(
      verify(token, "schedule.list", 50, new Date("2026-07-10T12:14:59.999Z"))
        .ok,
    ).toBe(true);
    expect(
      verify(token, "schedule.list", 50, new Date("2026-07-10T12:15:00.000Z")),
    ).toEqual(INVALID);

    const boundaryToken = issue(
      POSITIONS.scheduleList,
      50,
      new Date(NOW.getTime() + 60_000),
    );
    const beyondToken = issue(
      POSITIONS.scheduleList,
      50,
      new Date(NOW.getTime() + 60_001),
    );
    expect(verify(boundaryToken).ok).toBe(true);
    expect(verify(beyondToken)).toEqual(INVALID);
  });

  it("rejects invalid issue inputs with one fixed non-sensitive error", () => {
    const inputs = [
      { position: POSITIONS.scheduleList, pageSize: 0, now: NOW },
      { position: POSITIONS.scheduleList, pageSize: 101, now: NOW },
      {
        position: { ...POSITIONS.scheduleList, id: ENTITY_ID.toUpperCase() },
        pageSize: 50,
        now: NOW,
      },
      { position: POSITIONS.scheduleList, pageSize: 50, now: new Date(NaN) },
    ];
    for (const input of inputs) {
      expect(() =>
        cursorCodec().issue({
          ...input,
          filterFingerprint: FINGERPRINT,
        }),
      ).toThrow(PaginationCursorInputError);
    }
  });
});

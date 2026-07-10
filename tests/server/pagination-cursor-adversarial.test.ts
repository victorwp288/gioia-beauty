import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import {
  safeParsePaginationCursorTokenWire,
  type PaginationCursorScope,
} from "@/lib/domain/schemas/cursors.ts";
import {
  PaginationCursorConfigurationError,
  PaginationCursorInputError,
  createPaginationCursorCodec,
} from "@/lib/server/paginationCursor.ts";

import {
  FINGERPRINT,
  INVALID,
  NOW,
  POSITIONS,
  PREVIOUS_KEY,
  PRIMARY_KEY,
  changedCharacter,
  cursorCodec,
  issue,
  signBytes,
  signRaw,
  tokenPayload,
  verify,
} from "./pagination-cursor-fixture.ts";

function verification(token: unknown) {
  return cursorCodec().verify({
    token,
    expectedScope: "schedule.list",
    filterFingerprint: FINGERPRINT,
    pageSize: 50,
    now: NOW,
  });
}

function fixedConfigurationError(configuration: unknown): void {
  let caught: unknown;
  try {
    createPaginationCursorCodec(configuration as never);
  } catch (error) {
    caught = error;
  }
  expect(caught).toEqual(new PaginationCursorConfigurationError());
  expect(String(caught)).toBe(
    "PaginationCursorConfigurationError: Pagination cursors are not configured",
  );
}

describe("pagination cursor hostile boundaries", () => {
  it("enforces exact canonical wire framing and the 512-byte ceiling", () => {
    const signature = "A".repeat(43);
    const accepted = `c1-k.${"A".repeat(463)}.${signature}`;
    const rejected = `c1-k.${"A".repeat(464)}.${signature}`;
    expect(accepted).toHaveLength(512);
    expect(safeParsePaginationCursorTokenWire(accepted)?.token).toBe(accepted);
    expect(rejected).toHaveLength(513);

    for (const candidate of [
      rejected,
      ` ${accepted}`,
      `${accepted} `,
      `${accepted}\n`,
      `${accepted}\0`,
      `c1-k.AA.${signature}`.replace("AA", "A="),
      `c1-k.A+.${signature}`,
      `c1-k.A/.${signature}`,
      `c1-k.AA.${"A".repeat(42)}`,
      `c1-k.AA.${"A".repeat(44)}`,
      `c1-k.AA.${"A".repeat(42)}B`,
      `c2-k.AA.${signature}`,
      `c1-bad-key.AA.${signature}`,
      `c1-k.AA`,
      `c1-k.AA.${signature}.extra`,
    ]) {
      expect(safeParsePaginationCursorTokenWire(candidate)).toBeNull();
      expect(verification(candidate)).toEqual(INVALID);
    }
  });

  it("rejects independent header, payload, signature, and key tampering", () => {
    const token = issue();
    const [header = "", payload = "", tag = ""] = token.split(".");
    for (const candidate of [
      `c1-unknown.${payload}.${tag}`,
      `${header}.${changedCharacter(payload, 1)}.${tag}`,
      `${header}.${payload}.${changedCharacter(tag, 1)}`,
      `c1-primary_2.${payload}.${tag}`,
    ]) {
      expect(verification(candidate)).toEqual(INVALID);
    }
  });

  it("authenticates before rejecting malformed or noncanonical JSON", () => {
    const canonical = tokenPayload(issue());
    const issuedAt = canonical.issuedAt as string;
    const expiresAt = canonical.expiresAt as string;
    const reordered = JSON.stringify({
      scope: canonical.scope,
      version: canonical.version,
      filterFingerprint: canonical.filterFingerprint,
      pageSize: canonical.pageSize,
      date: canonical.date,
      startMinutes: canonical.startMinutes,
      id: canonical.id,
      issuedAt,
      expiresAt,
    });
    const offsetTimes = JSON.stringify({
      ...canonical,
      issuedAt: "2026-07-10T14:00:00.000+02:00",
      expiresAt: "2026-07-10T14:15:00.000+02:00",
    });
    const raw = JSON.stringify(canonical);
    const duplicateVersion = raw.replace(
      '"version":1',
      '"version":1,"version":1',
    );
    const cases = [
      "not-json",
      "null",
      "[]",
      reordered,
      offsetTimes,
      duplicateVersion,
      JSON.stringify({ ...canonical, extra: true }),
      JSON.stringify({ ...canonical, id: String(canonical.id).toUpperCase() }),
      JSON.stringify({ ...canonical, pageSize: 51 }),
      JSON.stringify({ ...canonical, scope: "schedule.export" }),
      JSON.stringify({ ...canonical, version: 2 }),
      JSON.stringify({ ...canonical, expiresAt: issuedAt }),
      JSON.stringify({
        ...canonical,
        issuedAt: expiresAt,
        expiresAt: issuedAt,
      }),
    ];
    for (const candidate of cases) {
      expect(verification(signRaw(candidate))).toEqual(INVALID);
    }
    expect(verification(signBytes(Uint8Array.of(0xff)))).toEqual(INVALID);
  });

  it("preserves canonical six-digit database instants only", () => {
    const token = cursorCodec().issue({
      position: POSITIONS.subscribers,
      filterFingerprint: FINGERPRINT,
      pageSize: 50,
      now: NOW,
    });
    const payload = tokenPayload(token);
    for (const createdAt of [
      "2026-07-10T11:59:59.123Z",
      "2026-07-10T11:59:59.1234567Z",
      "2026-07-10T13:59:59.123456+02:00",
      "2026-02-30T11:59:59.123456Z",
    ]) {
      const candidate = signRaw(JSON.stringify({ ...payload, createdAt }));
      expect(
        cursorCodec().verify({
          token: candidate,
          expectedScope: "subscribers.list",
          filterFingerprint: FINGERPRINT,
          pageSize: 50,
          now: NOW,
        }),
      ).toEqual(INVALID);
    }
  });

  it("collapses hostile verification inputs without invoking accessors", () => {
    let getterCalls = 0;
    const accessor = Object.defineProperty({}, "token", {
      enumerable: true,
      get() {
        getterCalls += 1;
        return issue();
      },
    });
    for (const [key, value] of [
      ["expectedScope", "schedule.list"],
      ["filterFingerprint", FINGERPRINT],
      ["pageSize", 50],
      ["now", NOW],
    ] as const) {
      Object.defineProperty(accessor, key, { enumerable: true, value });
    }
    const { proxy: revoked, revoke } = Proxy.revocable({}, {});
    revoke();
    class Input {}

    for (const candidate of [
      accessor,
      new Proxy({}, {}),
      revoked,
      new Input(),
      Object.create({ token: issue() }),
    ]) {
      expect(cursorCodec().verify(candidate as never)).toEqual(INVALID);
    }
    expect(getterCalls).toBe(0);
  });

  it("rejects hostile issue positions with one fixed error", () => {
    let getterCalls = 0;
    const accessorPosition = Object.defineProperty(
      { scope: "schedule.list", date: "2026-07-10", startMinutes: 600 },
      "id",
      {
        enumerable: true,
        get() {
          getterCalls += 1;
          return POSITIONS.scheduleList.id;
        },
      },
    );
    const issueInput = (position: unknown) => ({
      position,
      filterFingerprint: FINGERPRINT,
      pageSize: 50,
      now: NOW,
    });
    for (const candidate of [
      accessorPosition,
      new Proxy(POSITIONS.scheduleList, {}),
      { ...POSITIONS.scheduleList, extra: true },
      { ...POSITIONS.scheduleList, [Symbol("extra")]: true },
      Object.create(POSITIONS.scheduleList),
    ]) {
      expect(() => cursorCodec().issue(issueInput(candidate) as never)).toThrow(
        PaginationCursorInputError,
      );
    }
    expect(getterCalls).toBe(0);
  });

  it("accepts only exact copied one-to-three-key configurations", () => {
    const third = {
      id: "third_1",
      secret: Buffer.alloc(32, 0x7c).toString("base64url"),
    };
    expect(() =>
      createPaginationCursorCodec({
        activeKeyId: PRIMARY_KEY.id,
        keys: [PRIMARY_KEY, PREVIOUS_KEY, third],
      }),
    ).not.toThrow();

    const sparse = Array(1);
    const decorated = Object.assign([PRIMARY_KEY], { extra: true });
    for (const configuration of [
      { activeKeyId: PRIMARY_KEY.id, keys: [] },
      {
        activeKeyId: PRIMARY_KEY.id,
        keys: [PRIMARY_KEY, PREVIOUS_KEY, third, third],
      },
      { activeKeyId: "missing", keys: [PRIMARY_KEY] },
      { activeKeyId: PRIMARY_KEY.id, keys: [PRIMARY_KEY, PRIMARY_KEY] },
      {
        activeKeyId: PRIMARY_KEY.id,
        keys: [{ ...PRIMARY_KEY, secret: "A".repeat(42) }],
      },
      { activeKeyId: PRIMARY_KEY.id, keys: sparse },
      { activeKeyId: PRIMARY_KEY.id, keys: decorated },
      { activeKeyId: PRIMARY_KEY.id, keys: new Proxy([PRIMARY_KEY], {}) },
      { activeKeyId: PRIMARY_KEY.id, keys: [new Proxy(PRIMARY_KEY, {})] },
      { activeKeyId: PRIMARY_KEY.id, keys: [PRIMARY_KEY], extra: true },
    ]) {
      fixedConfigurationError(configuration);
    }
  });

  it("rejects every cross-scope reuse pair", () => {
    const scopes = [
      "schedule.list",
      "schedule.export",
      "vacations.list",
      "subscribers.list",
      "outbox.list",
    ] satisfies PaginationCursorScope[];
    const token = issue();
    for (const scope of scopes.slice(1)) {
      expect(verify(token, scope as never)).toEqual(INVALID);
    }
  });
});

import { createHmac } from "node:crypto";

import type {
  PaginationCursorPositionInput,
  PaginationCursorScope,
} from "@/lib/domain/schemas/cursors.ts";
import {
  createPaginationCursorCodec,
  type PaginationCursorCodecConfiguration,
  type PaginationCursorKeyConfiguration,
} from "@/lib/server/paginationCursor.ts";

export const NOW = new Date("2026-07-10T12:00:00.000Z");
export const FINGERPRINT = "a".repeat(64);
export const OTHER_FINGERPRINT = "b".repeat(64);
export const ENTITY_ID = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
export const SECRET = Buffer.alloc(32, 0x5a).toString("base64url");
export const PREVIOUS_SECRET = Buffer.alloc(32, 0x6b).toString("base64url");
export const PRIMARY_KEY = Object.freeze({ id: "primary_1", secret: SECRET });
export const PREVIOUS_KEY = Object.freeze({
  id: "previous_1",
  secret: PREVIOUS_SECRET,
});
export const INVALID = Object.freeze({
  ok: false,
  code: "INVALID_CURSOR",
});

export const POSITIONS = Object.freeze({
  scheduleList: Object.freeze({
    scope: "schedule.list" as const,
    date: "2026-07-10",
    startMinutes: 600,
    id: ENTITY_ID,
  }),
  scheduleExport: Object.freeze({
    scope: "schedule.export" as const,
    date: "2026-07-10",
    startMinutes: 600,
    id: ENTITY_ID,
  }),
  vacations: Object.freeze({
    scope: "vacations.list" as const,
    startDate: "2026-07-10",
    id: ENTITY_ID,
  }),
  subscribers: Object.freeze({
    scope: "subscribers.list" as const,
    createdAt: "2026-07-10T11:59:59.123456Z",
    id: ENTITY_ID,
  }),
  outbox: Object.freeze({
    scope: "outbox.list" as const,
    createdAt: "2026-07-10T11:59:59.123457Z",
    id: ENTITY_ID,
  }),
});

export const GOLDEN_TOKENS = Object.freeze({
  "schedule.list":
    "c1-primary_1.eyJ2ZXJzaW9uIjoxLCJzY29wZSI6InNjaGVkdWxlLmxpc3QiLCJmaWx0ZXJGaW5nZXJwcmludCI6ImFhYWFhYWFhYWFhYWFhYWFhYWFhYWFhYWFhYWFhYWFhYWFhYWFhYWFhYWFhYWFhYWFhYWFhYWFhYWFhYWFhYWEiLCJwYWdlU2l6ZSI6MTAwLCJkYXRlIjoiMjAyNi0wNy0xMCIsInN0YXJ0TWludXRlcyI6NjAwLCJpZCI6ImJiYmJiYmJiLWJiYmItNGJiYi04YmJiLWJiYmJiYmJiYmJiYiIsImlzc3VlZEF0IjoiMjAyNi0wNy0xMFQxMjowMDowMC4wMDBaIiwiZXhwaXJlc0F0IjoiMjAyNi0wNy0xMFQxMjoxNTowMC4wMDBaIn0.8LfyM00mqXh8yCXjn979DIiJX64Z7c-SZj-X9-Ufa_Y",
  "schedule.export":
    "c1-primary_1.eyJ2ZXJzaW9uIjoxLCJzY29wZSI6InNjaGVkdWxlLmV4cG9ydCIsImZpbHRlckZpbmdlcnByaW50IjoiYWFhYWFhYWFhYWFhYWFhYWFhYWFhYWFhYWFhYWFhYWFhYWFhYWFhYWFhYWFhYWFhYWFhYWFhYWFhYWFhYWFhYSIsInBhZ2VTaXplIjo1MDAsImRhdGUiOiIyMDI2LTA3LTEwIiwic3RhcnRNaW51dGVzIjo2MDAsImlkIjoiYmJiYmJiYmItYmJiYi00YmJiLThiYmItYmJiYmJiYmJiYmJiIiwiaXNzdWVkQXQiOiIyMDI2LTA3LTEwVDEyOjAwOjAwLjAwMFoiLCJleHBpcmVzQXQiOiIyMDI2LTA3LTEwVDEyOjE1OjAwLjAwMFoifQ.QS7ntYNRkILaaZNnxjtdm4F0dgD4tqH0DEdD9yHURIY",
  "vacations.list":
    "c1-primary_1.eyJ2ZXJzaW9uIjoxLCJzY29wZSI6InZhY2F0aW9ucy5saXN0IiwiZmlsdGVyRmluZ2VycHJpbnQiOiJhYWFhYWFhYWFhYWFhYWFhYWFhYWFhYWFhYWFhYWFhYWFhYWFhYWFhYWFhYWFhYWFhYWFhYWFhYWFhYWFhYWFhIiwicGFnZVNpemUiOjEwMCwic3RhcnREYXRlIjoiMjAyNi0wNy0xMCIsImlkIjoiYmJiYmJiYmItYmJiYi00YmJiLThiYmItYmJiYmJiYmJiYmJiIiwiaXNzdWVkQXQiOiIyMDI2LTA3LTEwVDEyOjAwOjAwLjAwMFoiLCJleHBpcmVzQXQiOiIyMDI2LTA3LTEwVDEyOjE1OjAwLjAwMFoifQ._U9DXxnToMhH4OBZm1XR3cF0jgysZF0zMxH38NIfRRs",
  "subscribers.list":
    "c1-primary_1.eyJ2ZXJzaW9uIjoxLCJzY29wZSI6InN1YnNjcmliZXJzLmxpc3QiLCJmaWx0ZXJGaW5nZXJwcmludCI6ImFhYWFhYWFhYWFhYWFhYWFhYWFhYWFhYWFhYWFhYWFhYWFhYWFhYWFhYWFhYWFhYWFhYWFhYWFhYWFhYWFhYWEiLCJwYWdlU2l6ZSI6MTAwLCJjcmVhdGVkQXQiOiIyMDI2LTA3LTEwVDExOjU5OjU5LjEyMzQ1NloiLCJpZCI6ImJiYmJiYmJiLWJiYmItNGJiYi04YmJiLWJiYmJiYmJiYmJiYiIsImlzc3VlZEF0IjoiMjAyNi0wNy0xMFQxMjowMDowMC4wMDBaIiwiZXhwaXJlc0F0IjoiMjAyNi0wNy0xMFQxMjoxNTowMC4wMDBaIn0.wqBcYhqHVNPI3L2uuDdYsRLSg8z5MD2XFvLWoNvqGNI",
  "outbox.list":
    "c1-primary_1.eyJ2ZXJzaW9uIjoxLCJzY29wZSI6Im91dGJveC5saXN0IiwiZmlsdGVyRmluZ2VycHJpbnQiOiJhYWFhYWFhYWFhYWFhYWFhYWFhYWFhYWFhYWFhYWFhYWFhYWFhYWFhYWFhYWFhYWFhYWFhYWFhYWFhYWFhYWFhIiwicGFnZVNpemUiOjEwMCwiY3JlYXRlZEF0IjoiMjAyNi0wNy0xMFQxMTo1OTo1OS4xMjM0NTdaIiwiaWQiOiJiYmJiYmJiYi1iYmJiLTRiYmItOGJiYi1iYmJiYmJiYmJiYmIiLCJpc3N1ZWRBdCI6IjIwMjYtMDctMTBUMTI6MDA6MDAuMDAwWiIsImV4cGlyZXNBdCI6IjIwMjYtMDctMTBUMTI6MTU6MDAuMDAwWiJ9._zjHgm5CaNtshJMELZibFaIysn6hut_4e1n1CxVl8U8",
});

export function cursorCodec(
  configuration: PaginationCursorCodecConfiguration = {
    activeKeyId: PRIMARY_KEY.id,
    keys: [PRIMARY_KEY],
  },
) {
  return createPaginationCursorCodec(configuration);
}

export function issue(
  position: PaginationCursorPositionInput = POSITIONS.scheduleList,
  pageSize = 50,
  now = NOW,
) {
  return cursorCodec().issue({
    position,
    filterFingerprint: FINGERPRINT,
    pageSize,
    now,
  });
}

export function verify(
  token: unknown,
  expectedScope: PaginationCursorScope = POSITIONS.scheduleList.scope,
  pageSize = 50,
  now = NOW,
  filterFingerprint = FINGERPRINT,
) {
  return cursorCodec().verify({
    token,
    expectedScope,
    filterFingerprint,
    pageSize,
    now,
  });
}

export function signRaw(
  raw: string,
  key: PaginationCursorKeyConfiguration = PRIMARY_KEY,
  header = `c1-${key.id}`,
): string {
  const payload = Buffer.from(raw, "utf8").toString("base64url");
  return signEncoded(payload, key, header);
}

export function signBytes(
  bytes: Uint8Array,
  key: PaginationCursorKeyConfiguration = PRIMARY_KEY,
): string {
  return signEncoded(Buffer.from(bytes).toString("base64url"), key);
}

export function signEncoded(
  payload: string,
  key: PaginationCursorKeyConfiguration = PRIMARY_KEY,
  header = `c1-${key.id}`,
): string {
  const tag = createHmac("sha256", Buffer.from(key.secret, "base64url"))
    .update(`gioia:pagination-cursor:v1\0${header}.${payload}`, "utf8")
    .digest("base64url");
  return `${header}.${payload}.${tag}`;
}

export function tokenPayload(token: string): Record<string, unknown> {
  const encoded = token.split(".")[1] ?? "";
  return JSON.parse(Buffer.from(encoded, "base64url").toString("utf8"));
}

export function changedCharacter(value: string, index: number): string {
  const replacement = value[index] === "A" ? "B" : "A";
  return `${value.slice(0, index)}${replacement}${value.slice(index + 1)}`;
}

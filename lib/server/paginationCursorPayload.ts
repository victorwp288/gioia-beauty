import "server-only";

import { TextDecoder } from "node:util";

import {
  PaginationCursorPayloadSchema,
  PaginationCursorPositionSchema,
  type PaginationCursorPayload,
  type PaginationCursorPosition,
  type PaginationCursorScope,
} from "@/lib/domain/schemas/cursors.ts";

import { exactDataObject } from "./exactData.ts";

const MAXIMUM_FUTURE_ISSUE_SKEW_MILLISECONDS = 60_000;
const FATAL_UTF8_DECODER = new TextDecoder("utf-8", { fatal: true });
const POSITION_KEYS = [
  ["scope", "date", "startMinutes", "id"],
  ["scope", "startDate", "id"],
  ["scope", "createdAt", "id"],
] as const;

function canonicalPosition(position: PaginationCursorPosition) {
  switch (position.scope) {
    case "schedule.list":
    case "schedule.export":
      return Object.freeze({
        scope: position.scope,
        date: position.date,
        startMinutes: position.startMinutes,
        id: position.id,
      });
    case "vacations.list":
      return Object.freeze({
        scope: position.scope,
        startDate: position.startDate,
        id: position.id,
      });
    case "subscribers.list":
    case "outbox.list":
      return Object.freeze({
        scope: position.scope,
        createdAt: position.createdAt,
        id: position.id,
      });
  }
}

export function parseExactPaginationCursorPosition(
  value: unknown,
): PaginationCursorPosition | null {
  for (const keys of POSITION_KEYS) {
    const snapshot = exactDataObject(value, keys);
    if (!snapshot) continue;
    const parsed = PaginationCursorPositionSchema.safeParse(snapshot);
    if (!parsed.success) continue;
    const canonical = canonicalPosition(parsed.data);
    if (JSON.stringify(snapshot) === JSON.stringify(canonical)) {
      return canonical;
    }
  }
  return null;
}

export function isPaginationCursorPageSizeValid(
  scope: PaginationCursorScope,
  value: unknown,
): value is number {
  const maximum = scope === "schedule.export" ? 500 : 100;
  return (
    typeof value === "number" &&
    Number.isInteger(value) &&
    value >= 1 &&
    value <= maximum
  );
}

function candidatePayload(
  position: PaginationCursorPosition,
  filterFingerprint: string,
  pageSize: number,
  issuedAt: string,
  expiresAt: string,
): unknown {
  const shared = {
    version: 1 as const,
    scope: position.scope,
    filterFingerprint,
    pageSize,
  };
  switch (position.scope) {
    case "schedule.list":
    case "schedule.export":
      return {
        ...shared,
        date: position.date,
        startMinutes: position.startMinutes,
        id: position.id,
        issuedAt,
        expiresAt,
      };
    case "vacations.list":
      return {
        ...shared,
        startDate: position.startDate,
        id: position.id,
        issuedAt,
        expiresAt,
      };
    case "subscribers.list":
    case "outbox.list":
      return {
        ...shared,
        createdAt: position.createdAt,
        id: position.id,
        issuedAt,
        expiresAt,
      };
  }
}

export function buildPaginationCursorPayload(
  position: PaginationCursorPosition,
  filterFingerprint: string,
  pageSize: number,
  issuedAt: string,
  expiresAt: string,
): PaginationCursorPayload | null {
  const parsed = PaginationCursorPayloadSchema.safeParse(
    candidatePayload(
      position,
      filterFingerprint,
      pageSize,
      issuedAt,
      expiresAt,
    ),
  );
  return parsed.success ? parsed.data : null;
}

export function canonicalPaginationCursorPayload(
  payload: PaginationCursorPayload,
): Readonly<PaginationCursorPayload> {
  return Object.freeze(
    candidatePayload(
      payload,
      payload.filterFingerprint,
      payload.pageSize,
      payload.issuedAt,
      payload.expiresAt,
    ),
  ) as Readonly<PaginationCursorPayload>;
}

export function encodePaginationCursorPayload(
  payload: PaginationCursorPayload,
): string {
  return Buffer.from(
    JSON.stringify(canonicalPaginationCursorPayload(payload)),
    "utf8",
  ).toString("base64url");
}

export function parseCanonicalPaginationCursorPayload(
  encoded: string,
): PaginationCursorPayload | null {
  let raw: string;
  let input: unknown;
  try {
    const bytes = Buffer.from(encoded, "base64url");
    if (bytes.toString("base64url") !== encoded) return null;
    raw = FATAL_UTF8_DECODER.decode(bytes);
    input = JSON.parse(raw);
  } catch {
    return null;
  }
  const parsed = PaginationCursorPayloadSchema.safeParse(input);
  if (!parsed.success) return null;
  const canonical = canonicalPaginationCursorPayload(parsed.data);
  const canonicalRaw = JSON.stringify(canonical);
  if (
    raw !== canonicalRaw ||
    encoded !== Buffer.from(canonicalRaw, "utf8").toString("base64url")
  ) {
    return null;
  }
  return parsed.data;
}

export function isPaginationCursorTimeValid(
  payload: PaginationCursorPayload,
  now: Date,
): boolean {
  const nowMilliseconds = now.getTime();
  const issuedAtMilliseconds = Date.parse(payload.issuedAt);
  const expiresAtMilliseconds = Date.parse(payload.expiresAt);
  return (
    Number.isFinite(nowMilliseconds) &&
    Number.isFinite(issuedAtMilliseconds) &&
    Number.isFinite(expiresAtMilliseconds) &&
    issuedAtMilliseconds <=
      nowMilliseconds + MAXIMUM_FUTURE_ISSUE_SKEW_MILLISECONDS &&
    expiresAtMilliseconds > nowMilliseconds
  );
}

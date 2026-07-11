import { vi } from "vitest";

import type { OwnerAuthorizationDecision } from "@/lib/server/auth/freshOwnerSession.ts";
import { issueOwnerSessionBinding } from "@/lib/server/auth/sessionBinding.ts";
import {
  createOwnerScheduleCountGetHandler,
  createOwnerScheduleListGetHandler,
} from "@/lib/server/ownerScheduleReadHandler.ts";

import { cursorCodec as createCursorCodec } from "./pagination-cursor-fixture.ts";

export const NOW = new Date("2035-01-15T12:00:00.000Z");
export const REQUEST_ID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
export const USER_ID = "10000000-0000-4000-8000-000000000001";
export const SESSION_ID = "20000000-0000-4000-8000-000000000001";
export const BINDING_SECRET = "synthetic-owner-session-secret-32-bytes-minimum";
export const PII = "cliente@example.test";
export const LIST_QUERY = "fromDate=2035-02-01&toDate=2035-02-28&pageSize=2";
export const COUNT_QUERY = "fromDate=2035-02-01&toDate=2035-02-28";
export const IDS = [
  "11111111-1111-4111-8111-111111111111",
  "22222222-2222-4222-8222-222222222222",
  "33333333-3333-4333-8333-333333333333",
] as const;

function accessToken() {
  const encode = (value: unknown) =>
    Buffer.from(JSON.stringify(value), "utf8").toString("base64url");
  return `${encode({ alg: "HS256" })}.${encode({
    sub: USER_ID,
    session_id: SESSION_ID,
  })}.synthetic-signature`;
}

export function appointment(
  id: string,
  overrides: Record<string, unknown> = {},
) {
  return {
    id,
    schemaVersion: 1,
    source: "admin",
    date: "2035-02-10",
    startMinutes: 600,
    serviceDurationMinutes: 60,
    bufferMinutes: 0,
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
    clientEmail: PII,
    clientPhone: "+393331234567",
    clientNote: null,
    internalNote: null,
    ...overrides,
  };
}

export function responseHeadersWithCookies() {
  const headers = new Headers({
    "access-control-allow-origin": "https://attacker.example.test",
    "cache-control": "public, max-age=3600",
    expires: "0",
    "x-private-detail": `recipient=${PII}`,
  });
  headers.append("set-cookie", "sb-auth.0=first; HttpOnly; Path=/; Secure");
  headers.append("set-cookie", "sb-auth.1=second; HttpOnly; Path=/; Secure");
  return headers;
}

interface FixtureOptions {
  readonly sessionMissing?: boolean;
  readonly sessionError?: unknown;
  readonly userError?: unknown;
  readonly bindingToken?: string | null;
  readonly authorization?: OwnerAuthorizationDecision;
  readonly authorizationError?: unknown;
  readonly clearError?: unknown;
  readonly signOutError?: unknown;
  readonly executeError?: unknown;
  readonly responseHeaders?: Headers;
  readonly readNow?: () => Date;
}

function createRuntimeFixture(options: FixtureOptions = {}) {
  const order: string[] = [];
  const token = accessToken();
  const getSession = vi.fn(async () => {
    order.push("getSession");
    return {
      data: {
        session:
          options.sessionMissing || options.sessionError
            ? null
            : { access_token: token },
      },
      error: options.sessionError ?? null,
    };
  });
  const getUser = vi.fn(async () => {
    order.push("getUser");
    return {
      data: { user: options.userError ? null : { id: USER_ID } },
      error: options.userError ?? null,
    };
  });
  const signOut = vi.fn(async () => {
    order.push("signOut");
    if (options.signOutError) throw options.signOutError;
    return { error: null };
  });
  const clear = vi.fn(() => {
    order.push("clear");
    if (options.clearError) throw options.clearError;
  });
  const authorizeSession = vi.fn(async () => {
    order.push("authorizeSession");
    if (options.authorizationError) throw options.authorizationError;
    return options.authorization ?? ({ ok: true } as const);
  });
  const loadRuntimeContext = vi.fn(async () => {
    order.push("loadRuntimeContext");
    return {
      auth: { getSession, getUser, signOut },
      bindingToken:
        options.bindingToken === undefined
          ? issueOwnerSessionBinding({
              userId: USER_ID,
              sessionId: SESSION_ID,
              secret: BINDING_SECRET,
              now: NOW,
            })
          : options.bindingToken,
      bindingSecret: BINDING_SECRET,
      authorizeSession,
      securityCookies: { clear },
      responseHeaders: options.responseHeaders ?? new Headers(),
    };
  });
  const readNow = vi.fn(options.readNow ?? (() => new Date(NOW)));
  return {
    authorizeSession,
    clear,
    getSession,
    getUser,
    loadRuntimeContext,
    order,
    readNow,
    signOut,
  };
}

export function createListFixture({
  rows = [],
  ...options
}: FixtureOptions & { readonly rows?: unknown } = {}) {
  const runtime = createRuntimeFixture(options);
  const baseCodec = createCursorCodec();
  const cursorCodec = {
    issue: vi.fn((input) => baseCodec.issue(input)),
    verify: vi.fn((input) => baseCodec.verify(input)),
  };
  const execute = vi.fn(async (_identity: unknown, _plan: unknown) => {
    runtime.order.push("execute");
    if (options.executeError) throw options.executeError;
    return rows;
  });
  const handler = createOwnerScheduleListGetHandler({
    cursorCodec,
    loadRuntimeContext: runtime.loadRuntimeContext,
    execute,
    createRequestId: () => REQUEST_ID,
    readNow: runtime.readNow,
  });
  return { ...runtime, cursorCodec, execute, handler };
}

export function createCountFixture({
  groups = [],
  ...options
}: FixtureOptions & { readonly groups?: unknown } = {}) {
  const runtime = createRuntimeFixture(options);
  const execute = vi.fn(async (_identity: unknown, _plan: unknown) => {
    runtime.order.push("execute");
    if (options.executeError) throw options.executeError;
    return groups;
  });
  const handler = createOwnerScheduleCountGetHandler({
    loadRuntimeContext: runtime.loadRuntimeContext,
    execute,
    createRequestId: () => REQUEST_ID,
    readNow: runtime.readNow,
  });
  return { ...runtime, execute, handler };
}

export function listRequest(query = LIST_QUERY) {
  return new Request(
    `https://preview.example.test/api/admin/schedule?${query}`,
  );
}

export function countRequest(query = COUNT_QUERY) {
  return new Request(
    `https://preview.example.test/api/admin/schedule/count?${query}`,
  );
}

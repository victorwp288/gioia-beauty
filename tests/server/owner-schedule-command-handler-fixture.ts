import type { z } from "zod";
import { vi } from "vitest";

import {
  AdminCancelScheduleEntryBodySchema,
  AdminCancelVacationBodySchema,
  AdminCreateAppointmentBodySchema,
  AdminCreateBlockBodySchema,
  AdminCreateVacationBodySchema,
} from "@/lib/domain/schemas/index.ts";
import { issueOwnerSessionBinding } from "@/lib/server/auth/sessionBinding.ts";
import type { OwnerScheduleCommandOperation } from "@/lib/server/database/ownerScheduleCommandContracts.ts";
import type { OwnerScheduleCommandResult } from "@/lib/server/database/ownerScheduleRepository.ts";
import type { OwnerTransactionIdentity } from "@/lib/server/database/runtime.ts";
import { createOwnerScheduleCommandHandler } from "@/lib/server/ownerScheduleCommandHandler.ts";

export const CSRF_TOKEN = "A".repeat(43);
export const IDEMPOTENCY_KEY = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
export const REQUEST_ID = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
export const RESOURCE_ID = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
export const USER_ID = "10000000-0000-4000-8000-000000000001";
export const SESSION_ID = "20000000-0000-4000-8000-000000000001";
export const PII = "cliente@example.test";
export const NOW = new Date("2035-01-01T12:00:00.000Z");
const BINDING_SECRET = "synthetic-owner-session-secret-32-bytes-minimum";

type Body = Record<string, unknown>;

export interface CommandCase {
  readonly name: string;
  readonly bodySchema: z.ZodType<Body>;
  readonly operation: OwnerScheduleCommandOperation;
  readonly rawBody: Body;
  readonly normalizedBody: Body;
  readonly status: 200 | 201;
  readonly code: string;
  readonly failureStatus: 400 | 404 | 409;
  readonly failureCode: string;
}

export const COMMAND_CASES: readonly CommandCase[] = [
  {
    name: "appointment creation",
    bodySchema: AdminCreateAppointmentBodySchema as z.ZodType<Body>,
    operation: "owner_create_appointment",
    rawBody: {
      date: "2035-02-05",
      startMinutes: 600,
      serviceId: "manicure",
      variantId: "manicure-30-min",
      clientName: " Cliente Test ",
      clientEmail: " CLIENTE@EXAMPLE.TEST ",
      clientPhone: " +39 333 123 4567 ",
    },
    normalizedBody: {
      date: "2035-02-05",
      startMinutes: 600,
      serviceId: "manicure",
      variantId: "manicure-30-min",
      clientName: "Cliente Test",
      clientEmail: PII,
      clientPhone: "+393331234567",
      clientNote: null,
    },
    status: 201,
    code: "APPOINTMENT_CREATED",
    failureStatus: 409,
    failureCode: "SLOT_UNAVAILABLE",
  },
  {
    name: "block creation",
    bodySchema: AdminCreateBlockBodySchema as z.ZodType<Body>,
    operation: "owner_create_block",
    rawBody: {
      date: "2035-02-05",
      startMinutes: 720,
      durationMinutes: 30,
    },
    normalizedBody: {
      date: "2035-02-05",
      startMinutes: 720,
      durationMinutes: 30,
      bufferMinutes: 0,
      internalNote: null,
    },
    status: 201,
    code: "BLOCK_CREATED",
    failureStatus: 400,
    failureCode: "BLOCK_NOTE_INVALID",
  },
  {
    name: "schedule cancellation",
    bodySchema: AdminCancelScheduleEntryBodySchema as z.ZodType<Body>,
    operation: "owner_cancel_schedule_entry",
    rawBody: {
      entryId: "DDDDDDDD-DDDD-4DDD-8DDD-DDDDDDDDDDDD",
      expectedVersion: 2,
    },
    normalizedBody: {
      entryId: "dddddddd-dddd-4ddd-8ddd-dddddddddddd",
      expectedVersion: 2,
      reason: null,
    },
    status: 200,
    code: "SCHEDULE_ENTRY_CANCELLED",
    failureStatus: 404,
    failureCode: "SCHEDULE_ENTRY_NOT_FOUND",
  },
  {
    name: "vacation creation",
    bodySchema: AdminCreateVacationBodySchema as z.ZodType<Body>,
    operation: "owner_create_vacation",
    rawBody: { startDate: "2035-02-10", endDate: "2035-02-11" },
    normalizedBody: {
      startDate: "2035-02-10",
      endDate: "2035-02-11",
      reason: null,
    },
    status: 201,
    code: "VACATION_CREATED",
    failureStatus: 409,
    failureCode: "VACATION_OVERLAP",
  },
  {
    name: "vacation cancellation",
    bodySchema: AdminCancelVacationBodySchema as z.ZodType<Body>,
    operation: "owner_cancel_vacation",
    rawBody: {
      vacationId: "EEEEEEEE-EEEE-4EEE-8EEE-EEEEEEEEEEEE",
      expectedVersion: 3,
    },
    normalizedBody: {
      vacationId: "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee",
      expectedVersion: 3,
    },
    status: 200,
    code: "VACATION_CANCELLED",
    failureStatus: 409,
    failureCode: "VACATION_NOT_CANCELLABLE",
  },
];

function accessToken() {
  const encode = (value: unknown) =>
    Buffer.from(JSON.stringify(value), "utf8").toString("base64url");
  return `${encode({ alg: "HS256" })}.${encode({
    sub: USER_ID,
    session_id: SESSION_ID,
  })}.synthetic-signature`;
}

export function commandRequest(
  body: Body,
  headers: Record<string, string> = {},
) {
  return new Request("https://preview.example.test/api/admin/command", {
    method: "POST",
    headers: {
      host: "preview.example.test",
      origin: "https://preview.example.test",
      "content-type": "application/json",
      "idempotency-key": IDEMPOTENCY_KEY,
      "x-csrf-token": CSRF_TOKEN,
      ...headers,
    },
    body: JSON.stringify(body),
  });
}

export function responseHeadersWithCookies() {
  const headers = new Headers({
    "cache-control": "public, max-age=3600",
    expires: "0",
    "x-private-detail": `recipient=${PII}`,
  });
  headers.append("set-cookie", "sb-auth.0=first; HttpOnly; Path=/; Secure");
  headers.append("set-cookie", "sb-auth.1=second; HttpOnly; Path=/; Secure");
  return headers;
}

export function createHandlerFixture(
  commandCase: CommandCase = COMMAND_CASES[0]!,
  {
    replayed = false,
    sessionError = null,
    responseHeaders = new Headers(),
    bodySchema = commandCase.bodySchema,
    observedOrder,
  }: {
    replayed?: boolean;
    sessionError?: unknown;
    responseHeaders?: Headers;
    bodySchema?: z.ZodType<Body>;
    observedOrder?: string[];
  } = {},
) {
  const order = observedOrder ?? [];
  const token = accessToken();
  const getSession = vi.fn(async () => {
    order.push("getSession");
    return {
      data: { session: sessionError ? null : { access_token: token } },
      error: sessionError,
    };
  });
  const getUser = vi.fn(async () => {
    order.push("getUser");
    return { data: { user: { id: USER_ID } }, error: null };
  });
  const signOut = vi.fn(async () => {
    order.push("signOut");
    return { error: null };
  });
  const clear = vi.fn(() => {
    order.push("clear");
  });
  const execute = vi.fn(
    async (
      _identity: OwnerTransactionIdentity,
      _command: Body & { readonly idempotencyKey: string },
      _fingerprint: Buffer,
    ): Promise<OwnerScheduleCommandResult> => {
      order.push("execute");
      return {
        http_status: commandCase.status,
        result: { code: commandCase.code, resource_id: RESOURCE_ID },
        replayed,
      };
    },
  );
  const loadRuntimeContext = vi.fn(async () => {
    order.push("loadRuntimeContext");
    return {
      auth: { getSession, getUser, signOut },
      bindingToken: issueOwnerSessionBinding({
        userId: USER_ID,
        sessionId: SESSION_ID,
        secret: BINDING_SECRET,
        now: NOW,
      }),
      bindingSecret: BINDING_SECRET,
      securityCookies: { clear },
      responseHeaders,
    };
  });
  const handler = createOwnerScheduleCommandHandler({
    csrfCookieToken: CSRF_TOKEN,
    bodySchema,
    operation: commandCase.operation,
    version: 1,
    loadRuntimeContext,
    execute,
    writeGate: {
      check: vi.fn(async () => ({
        ok: true as const,
        canaryToken: null,
        mode: "open" as const,
      })),
    },
    createRequestId: () => REQUEST_ID,
    now: NOW,
  });

  return {
    clear,
    execute,
    getSession,
    getUser,
    handler,
    loadRuntimeContext,
    order,
    signOut,
  };
}

import "server-only";

import { randomUUID } from "node:crypto";

import {
  AdminSubscriberListResponseSchema,
  AdminVacationListResponseSchema,
  parseSubscriberListSearchParams,
  parseVacationListSearchParams,
} from "@/lib/domain/schemas/index.ts";

import { createOwnerSubscriberListResponse } from "./database/ownerSubscriberListResponseContract.ts";
import {
  createOwnerSubscriberListReadRequest,
  type OwnerSubscriberListReadRequest,
} from "./database/ownerSubscriberReadContract.ts";
import { createOwnerVacationListResponse } from "./database/ownerVacationListResponseContract.ts";
import {
  createOwnerVacationListReadRequest,
  type OwnerVacationListReadRequest,
} from "./database/ownerVacationReadContract.ts";
import type { PaginationCursorCodec } from "./paginationCursor.ts";
import {
  boundedOwnerReadSearchParams,
  createOwnerReadHandler,
  ownerReadClockSnapshot,
  type OwnerReadHandlerOptions,
  type PreparedOwnerRead,
} from "./ownerScheduleReadHandlerSupport.ts";

interface PaginatedOwnerReadHandlerOptions<
  TPlan,
> extends OwnerReadHandlerOptions<TPlan> {
  readonly cursorCodec: Pick<PaginationCursorCodec, "issue" | "verify">;
}

export type OwnerVacationListHandlerOptions =
  PaginatedOwnerReadHandlerOptions<OwnerVacationListReadRequest>;
export type OwnerSubscriberListHandlerOptions =
  PaginatedOwnerReadHandlerOptions<OwnerSubscriberListReadRequest>;

export function createOwnerVacationListGetHandler({
  cursorCodec,
  loadRuntimeContext,
  execute,
  createRequestId = randomUUID,
  readNow = () => new Date(),
}: OwnerVacationListHandlerOptions) {
  return createOwnerReadHandler({
    createRequestId,
    loadRuntimeContext,
    execute,
    responseSchema: AdminVacationListResponseSchema,
    prepare(request): PreparedOwnerRead<OwnerVacationListReadRequest> {
      const search = boundedOwnerReadSearchParams(request, 4);
      if (!search.ok) return search;
      let query;
      try {
        query = parseVacationListSearchParams(search.searchParams);
      } catch {
        return { ok: false, status: 422, code: "INVALID_QUERY" };
      }
      const now = ownerReadClockSnapshot(readNow);
      if (!now) return { ok: false, status: 503, code: "SERVICE_UNAVAILABLE" };
      try {
        const result = createOwnerVacationListReadRequest({
          query,
          cursorCodec,
          now,
        });
        return result.ok
          ? { ok: true, plan: result.request, now }
          : { ok: false, status: 400, code: "INVALID_CURSOR" };
      } catch {
        return { ok: false, status: 503, code: "SERVICE_UNAVAILABLE" };
      }
    },
    respond: (plan, result, now) =>
      createOwnerVacationListResponse({
        request: plan,
        rows: result,
        cursorCodec,
        now,
      }),
  });
}

export function createOwnerSubscriberListGetHandler({
  cursorCodec,
  loadRuntimeContext,
  execute,
  createRequestId = randomUUID,
  readNow = () => new Date(),
}: OwnerSubscriberListHandlerOptions) {
  return createOwnerReadHandler({
    createRequestId,
    loadRuntimeContext,
    execute,
    responseSchema: AdminSubscriberListResponseSchema,
    prepare(request): PreparedOwnerRead<OwnerSubscriberListReadRequest> {
      const search = boundedOwnerReadSearchParams(request, 8);
      if (!search.ok) return search;
      let query;
      try {
        query = parseSubscriberListSearchParams(search.searchParams);
      } catch {
        return { ok: false, status: 422, code: "INVALID_QUERY" };
      }
      const now = ownerReadClockSnapshot(readNow);
      if (!now) return { ok: false, status: 503, code: "SERVICE_UNAVAILABLE" };
      try {
        const result = createOwnerSubscriberListReadRequest({
          query,
          cursorCodec,
          now,
        });
        return result.ok
          ? { ok: true, plan: result.request, now }
          : { ok: false, status: 400, code: "INVALID_CURSOR" };
      } catch {
        return { ok: false, status: 503, code: "SERVICE_UNAVAILABLE" };
      }
    },
    respond: (plan, result, now) =>
      createOwnerSubscriberListResponse({
        request: plan,
        rows: result,
        cursorCodec,
        now,
      }),
  });
}

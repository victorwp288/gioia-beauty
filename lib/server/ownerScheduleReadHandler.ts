import "server-only";

import { randomUUID } from "node:crypto";

import {
  AdminScheduleListResponseSchema,
  ScheduleCountResponseSchema,
  parseScheduleCountSearchParams,
  parseScheduleListSearchParams,
} from "@/lib/domain/schemas/index.ts";

import {
  createOwnerScheduleCountReadRequest,
  createOwnerScheduleCountResponse,
  type OwnerScheduleCountReadRequest,
} from "./database/ownerScheduleCountReadContract.ts";
import { createOwnerScheduleListResponse } from "./database/ownerScheduleListResponseContract.ts";
import {
  createOwnerScheduleListReadRequest,
  type OwnerScheduleListReadRequest,
} from "./database/ownerScheduleReadContract.ts";
import type { PaginationCursorCodec } from "./paginationCursor.ts";
import {
  boundedOwnerReadSearchParams,
  createOwnerReadHandler,
  ownerReadClockSnapshot,
  type OwnerReadHandlerOptions,
  type PreparedOwnerRead,
} from "./ownerScheduleReadHandlerSupport.ts";

export interface OwnerScheduleListHandlerOptions extends OwnerReadHandlerOptions<OwnerScheduleListReadRequest> {
  readonly cursorCodec: Pick<PaginationCursorCodec, "issue" | "verify">;
}

export type OwnerScheduleCountHandlerOptions =
  OwnerReadHandlerOptions<OwnerScheduleCountReadRequest>;

export function createOwnerScheduleListGetHandler({
  cursorCodec,
  loadRuntimeContext,
  execute,
  createRequestId = randomUUID,
  readNow = () => new Date(),
}: OwnerScheduleListHandlerOptions) {
  return createOwnerReadHandler({
    createRequestId,
    loadRuntimeContext,
    execute,
    responseSchema: AdminScheduleListResponseSchema,
    prepare(request): PreparedOwnerRead<OwnerScheduleListReadRequest> {
      const search = boundedOwnerReadSearchParams(request, 10);
      if (!search.ok) return search;
      let query;
      try {
        query = parseScheduleListSearchParams(search.searchParams);
      } catch {
        return { ok: false, status: 422, code: "INVALID_QUERY" };
      }
      const now = ownerReadClockSnapshot(readNow);
      if (!now) return { ok: false, status: 503, code: "SERVICE_UNAVAILABLE" };
      try {
        const result = createOwnerScheduleListReadRequest({
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
      createOwnerScheduleListResponse({
        request: plan,
        rows: result,
        cursorCodec,
        now,
      }),
  });
}

export function createOwnerScheduleCountGetHandler({
  loadRuntimeContext,
  execute,
  createRequestId = randomUUID,
  readNow = () => new Date(),
}: OwnerScheduleCountHandlerOptions) {
  return createOwnerReadHandler({
    createRequestId,
    loadRuntimeContext,
    execute,
    responseSchema: ScheduleCountResponseSchema,
    prepare(request): PreparedOwnerRead<OwnerScheduleCountReadRequest> {
      const search = boundedOwnerReadSearchParams(request, 8);
      if (!search.ok) return search;
      let query;
      try {
        query = parseScheduleCountSearchParams(search.searchParams);
      } catch {
        return { ok: false, status: 422, code: "INVALID_QUERY" };
      }
      const now = ownerReadClockSnapshot(readNow);
      if (!now) return { ok: false, status: 503, code: "SERVICE_UNAVAILABLE" };
      try {
        return {
          ok: true,
          plan: createOwnerScheduleCountReadRequest(query),
          now,
        };
      } catch {
        return { ok: false, status: 503, code: "SERVICE_UNAVAILABLE" };
      }
    },
    respond: (plan, result) => createOwnerScheduleCountResponse(plan, result),
  });
}

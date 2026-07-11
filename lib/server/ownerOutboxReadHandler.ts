import "server-only";

import { randomUUID } from "node:crypto";

import {
  AdminOutboxListResponseSchema,
  parseOutboxListSearchParams,
} from "@/lib/domain/schemas/index.ts";

import { createOwnerOutboxListResponse } from "./database/ownerOutboxListResponseContract.ts";
import {
  createOwnerOutboxListReadRequest,
  type OwnerOutboxListReadRequest,
} from "./database/ownerOutboxReadContract.ts";
import type { PaginationCursorCodec } from "./paginationCursor.ts";
import {
  boundedOwnerReadSearchParams,
  createOwnerReadHandler,
  ownerReadClockSnapshot,
  type OwnerReadHandlerOptions,
  type PreparedOwnerRead,
} from "./ownerScheduleReadHandlerSupport.ts";

export interface OwnerOutboxListHandlerOptions extends OwnerReadHandlerOptions<OwnerOutboxListReadRequest> {
  readonly cursorCodec: Pick<PaginationCursorCodec, "issue" | "verify">;
}

export function createOwnerOutboxListGetHandler({
  cursorCodec,
  loadRuntimeContext,
  execute,
  createRequestId = randomUUID,
  readNow = () => new Date(),
}: OwnerOutboxListHandlerOptions) {
  return createOwnerReadHandler({
    createRequestId,
    loadRuntimeContext,
    execute,
    responseSchema: AdminOutboxListResponseSchema,
    prepare(request): PreparedOwnerRead<OwnerOutboxListReadRequest> {
      const search = boundedOwnerReadSearchParams(request, 9);
      if (!search.ok) return search;
      let query;
      try {
        query = parseOutboxListSearchParams(search.searchParams);
      } catch {
        return { ok: false, status: 422, code: "INVALID_QUERY" };
      }
      const now = ownerReadClockSnapshot(readNow);
      if (!now) return { ok: false, status: 503, code: "SERVICE_UNAVAILABLE" };
      try {
        const result = createOwnerOutboxListReadRequest({
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
      createOwnerOutboxListResponse({
        request: plan,
        rows: result,
        cursorCodec,
        now,
      }),
  });
}

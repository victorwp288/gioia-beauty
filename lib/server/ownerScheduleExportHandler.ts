import "server-only";

import { randomUUID } from "node:crypto";

import {
  PaginationCursorTokenWireSchema,
  parseScheduleExportSearchParams,
} from "@/lib/domain/schemas/index.ts";

import {
  createOwnerScheduleExportReadRequest,
  type OwnerScheduleExportReadRequest,
} from "./database/ownerScheduleExportReadContract.ts";
import {
  createOwnerScheduleExportPage,
  type OwnerScheduleExportPage,
} from "./database/ownerScheduleExportResponseContract.ts";
import { exactDataObject } from "./exactData.ts";
import type { PaginationCursorCodec } from "./paginationCursor.ts";
import { securePrivateResponseHeaders } from "./publicApiResponse.ts";
import {
  boundedOwnerReadSearchParams,
  createOwnerReadHandler,
  ownerReadClockSnapshot,
  type OwnerReadHandlerOptions,
  type PreparedOwnerRead,
} from "./ownerScheduleReadHandlerSupport.ts";

const EXPORT_FILENAME_PATTERN =
  /^gioia-beauty-schedule-[0-9]{4}-[0-9]{2}-[0-9]{2}_to_[0-9]{4}-[0-9]{2}-[0-9]{2}\.csv$/;

export interface OwnerScheduleExportHandlerOptions extends OwnerReadHandlerOptions<OwnerScheduleExportReadRequest> {
  readonly cursorCodec: Pick<PaginationCursorCodec, "issue" | "verify">;
}

function scheduleExportResponse(body: unknown, authHeaders: Headers): Response {
  const page = exactDataObject(body, [
    "csv",
    "filename",
    "nextCursor",
    "rowCount",
  ]);
  const cursor = page
    ? PaginationCursorTokenWireSchema.nullable().safeParse(page.nextCursor)
    : null;
  if (
    !page ||
    typeof page.csv !== "string" ||
    typeof page.filename !== "string" ||
    !EXPORT_FILENAME_PATTERN.test(page.filename) ||
    !cursor?.success ||
    !Number.isInteger(page.rowCount) ||
    (page.rowCount as number) < 0 ||
    (page.rowCount as number) > 500
  ) {
    throw new TypeError("Invalid schedule export page");
  }

  const headers = securePrivateResponseHeaders(authHeaders);
  headers.set("Content-Type", "text/csv; charset=utf-8");
  headers.set("Content-Disposition", `attachment; filename="${page.filename}"`);
  headers.set("X-Export-Row-Count", String(page.rowCount));
  if (cursor.data !== null) headers.set("X-Next-Cursor", cursor.data);
  return new Response(page.csv, { status: 200, headers });
}

export function createOwnerScheduleExportGetHandler({
  cursorCodec,
  loadRuntimeContext,
  execute,
  createRequestId = randomUUID,
  readNow = () => new Date(),
}: OwnerScheduleExportHandlerOptions) {
  return createOwnerReadHandler({
    createRequestId,
    loadRuntimeContext,
    execute,
    createSuccessResponse: scheduleExportResponse,
    prepare(request): PreparedOwnerRead<OwnerScheduleExportReadRequest> {
      const search = boundedOwnerReadSearchParams(request, 6);
      if (!search.ok) return search;
      let query;
      try {
        query = parseScheduleExportSearchParams(search.searchParams);
      } catch {
        return { ok: false, status: 422, code: "INVALID_QUERY" };
      }
      const now = ownerReadClockSnapshot(readNow);
      if (!now) return { ok: false, status: 503, code: "SERVICE_UNAVAILABLE" };
      try {
        const result = createOwnerScheduleExportReadRequest({
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
    respond: (plan, result, now): Readonly<OwnerScheduleExportPage> =>
      createOwnerScheduleExportPage({
        request: plan,
        rows: result,
        cursorCodec,
        now,
      }),
  });
}

import "server-only";

import { isDeepStrictEqual } from "node:util";

import {
  ScheduleExportQuerySchema,
  type ScheduleExportQuery,
} from "@/lib/domain/schemas/index.ts";
import { PaginationCursorPayloadSchema } from "@/lib/domain/schemas/cursors.ts";

import {
  type AuthenticatedPaginationCursor,
  type PaginationCursorCodec,
} from "../paginationCursor.ts";
import { createPaginationCursorFilterFingerprint } from "../paginationCursorFingerprint.ts";
import { isPaginationCursorTimeValid } from "../paginationCursorPayload.ts";
import {
  exactDataObject,
  exactDataObjectWithOptionalKeys,
} from "../exactData.ts";

export const OWNER_SCHEDULE_EXPORT_ORDER = Object.freeze([
  "date",
  "startMinutes",
  "id",
] as const);

type AuthenticatedScheduleExportCursor = Extract<
  AuthenticatedPaginationCursor,
  { readonly scope: "schedule.export" }
>;

export interface OwnerScheduleExportReadRequest {
  readonly fromDate: string;
  readonly toDate: string;
  readonly format: "csv";
  readonly includeNotes: boolean;
  readonly pageSize: number;
  /** Fetch one extra row so another page is proven without a count query. */
  readonly rowLimit: number;
  readonly after: Readonly<{
    date: string;
    startMinutes: number;
    id: string;
  }> | null;
  readonly order: typeof OWNER_SCHEDULE_EXPORT_ORDER;
  readonly filterFingerprint: string;
}

export type OwnerScheduleExportRequestResult =
  | Readonly<{ ok: true; request: Readonly<OwnerScheduleExportReadRequest> }>
  | Readonly<{ ok: false; code: "INVALID_CURSOR" }>;

export class OwnerScheduleExportContractError extends Error {
  constructor() {
    super("Owner schedule export result violated its contract");
    this.name = "OwnerScheduleExportContractError";
  }
}

const issuedExportRequests = new WeakSet<object>();

export function assertOwnerScheduleExportReadRequest(
  request: Readonly<OwnerScheduleExportReadRequest>,
): void {
  if (!issuedExportRequests.has(request)) {
    throw new OwnerScheduleExportContractError();
  }
}

function canonicalFilters(query: ScheduleExportQuery) {
  return Object.freeze({
    fromDate: query.fromDate,
    toDate: query.toDate,
    format: query.format,
    includeNotes: query.includeNotes,
  });
}

const exportCursorFields = [
  "version",
  "scope",
  "filterFingerprint",
  "pageSize",
  "date",
  "startMinutes",
  "id",
  "issuedAt",
  "expiresAt",
] as const;

export function verifyOwnerScheduleExportCursor(
  codec: Pick<PaginationCursorCodec, "verify">,
  token: unknown,
  filterFingerprint: string,
  pageSize: number,
  now: Date,
): AuthenticatedScheduleExportCursor | null {
  const verification = codec.verify({
    token,
    expectedScope: "schedule.export",
    filterFingerprint,
    pageSize,
    now,
  });
  const failure = exactDataObject(verification, ["ok", "code"]);
  if (failure?.ok === false && failure.code === "INVALID_CURSOR") return null;

  const success = exactDataObject(verification, ["ok", "cursor"]);
  const snapshot =
    success?.ok === true
      ? exactDataObject(success.cursor, exportCursorFields)
      : null;
  if (!snapshot) throw new OwnerScheduleExportContractError();

  const candidate = { ...snapshot };
  const parsed = PaginationCursorPayloadSchema.safeParse(candidate);
  if (
    !parsed.success ||
    !isDeepStrictEqual(candidate, parsed.data) ||
    parsed.data.scope !== "schedule.export" ||
    parsed.data.filterFingerprint !== filterFingerprint ||
    parsed.data.pageSize !== pageSize ||
    !isPaginationCursorTimeValid(parsed.data, now)
  ) {
    throw new OwnerScheduleExportContractError();
  }
  return parsed.data as AuthenticatedScheduleExportCursor;
}

export function createOwnerScheduleExportReadRequest(input: {
  readonly query: unknown;
  readonly cursorCodec: Pick<PaginationCursorCodec, "verify">;
  readonly now: Date;
}): OwnerScheduleExportRequestResult {
  const snapshot = exactDataObjectWithOptionalKeys(
    input.query,
    ["fromDate", "toDate"],
    ["format", "includeNotes", "pageSize", "cursor"],
  );
  if (!snapshot) throw new OwnerScheduleExportContractError();

  const candidate = { ...snapshot };
  const query = ScheduleExportQuerySchema.parse(candidate);
  if (!isDeepStrictEqual(candidate, query)) {
    // HTTP parsing must materialize defaults before crossing this boundary.
    throw new OwnerScheduleExportContractError();
  }
  const filters = canonicalFilters(query);
  const filterFingerprint = createPaginationCursorFilterFingerprint({
    scope: "schedule.export",
    filters,
  });
  let after: OwnerScheduleExportReadRequest["after"] = null;

  if (query.cursor !== undefined) {
    let cursor;
    try {
      cursor = verifyOwnerScheduleExportCursor(
        input.cursorCodec,
        query.cursor,
        filterFingerprint,
        query.pageSize,
        input.now,
      );
    } catch {
      throw new OwnerScheduleExportContractError();
    }
    if (!cursor) return Object.freeze({ ok: false, code: "INVALID_CURSOR" });
    after = Object.freeze({
      date: cursor.date,
      startMinutes: cursor.startMinutes,
      id: cursor.id,
    });
  }

  const request = Object.freeze({
    ...filters,
    pageSize: query.pageSize,
    rowLimit: query.pageSize + 1,
    after,
    order: OWNER_SCHEDULE_EXPORT_ORDER,
    filterFingerprint,
  });
  issuedExportRequests.add(request);
  return Object.freeze({ ok: true, request });
}

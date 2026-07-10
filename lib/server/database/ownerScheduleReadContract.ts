import "server-only";

import { isDeepStrictEqual } from "node:util";

import {
  ScheduleListQuerySchema,
  type ScheduleListQuery,
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
  exactDenseArray,
} from "../exactData.ts";

export const OWNER_SCHEDULE_LIST_ORDER = Object.freeze([
  "date",
  "startMinutes",
  "id",
] as const);

type ScheduleStatus = ScheduleListQuery["statuses"] extends
  readonly (infer Status)[] | undefined
  ? Status
  : never;
type AuthenticatedScheduleListCursor = Extract<
  AuthenticatedPaginationCursor,
  { readonly scope: "schedule.list" }
>;

export interface OwnerScheduleListReadRequest {
  readonly fromDate: string;
  readonly toDate: string;
  readonly kind: "appointment" | "block" | null;
  readonly statuses: readonly ScheduleStatus[];
  readonly pageSize: number;
  /** The repository must request this many rows to prove whether another page exists. */
  readonly rowLimit: number;
  readonly after: Readonly<{
    date: string;
    startMinutes: number;
    id: string;
  }> | null;
  readonly order: typeof OWNER_SCHEDULE_LIST_ORDER;
  readonly filterFingerprint: string;
}

export type OwnerScheduleListRequestResult =
  | Readonly<{ ok: true; request: Readonly<OwnerScheduleListReadRequest> }>
  | Readonly<{ ok: false; code: "INVALID_CURSOR" }>;

export class OwnerScheduleReadContractError extends Error {
  constructor() {
    super("Owner schedule read result violated its contract");
    this.name = "OwnerScheduleReadContractError";
  }
}

const issuedListRequests = new WeakSet<object>();

export function assertOwnerScheduleListReadRequest(
  request: Readonly<OwnerScheduleListReadRequest>,
): void {
  if (!issuedListRequests.has(request))
    throw new OwnerScheduleReadContractError();
}

function canonicalFilters(query: ScheduleListQuery) {
  return Object.freeze({
    fromDate: query.fromDate,
    toDate: query.toDate,
    kind: query.kind ?? null,
    statuses: Object.freeze([...(query.statuses ?? [])].sort()),
  });
}

function scheduleFingerprint(query: ScheduleListQuery): string {
  return createPaginationCursorFilterFingerprint({
    scope: "schedule.list",
    filters: canonicalFilters(query),
  });
}

function scheduleAfter(cursor: AuthenticatedScheduleListCursor) {
  if (cursor.scope !== "schedule.list")
    throw new OwnerScheduleReadContractError();
  return Object.freeze({
    date: cursor.date,
    startMinutes: cursor.startMinutes,
    id: cursor.id,
  });
}

const scheduleCursorFields = [
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

export function verifyOwnerScheduleListCursor(
  codec: Pick<PaginationCursorCodec, "verify">,
  token: unknown,
  filterFingerprint: string,
  pageSize: number,
  now: Date,
): AuthenticatedScheduleListCursor | null {
  const verification = codec.verify({
    token,
    expectedScope: "schedule.list",
    filterFingerprint,
    pageSize,
    now,
  });
  const failure = exactDataObject(verification, ["ok", "code"]);
  if (failure?.ok === false && failure.code === "INVALID_CURSOR") return null;
  const success = exactDataObject(verification, ["ok", "cursor"]);
  const cursorSnapshot =
    success?.ok === true
      ? exactDataObject(success.cursor, scheduleCursorFields)
      : null;
  if (!cursorSnapshot) throw new OwnerScheduleReadContractError();
  const candidate = { ...cursorSnapshot };
  const parsed = PaginationCursorPayloadSchema.safeParse(candidate);
  if (
    !parsed.success ||
    !isDeepStrictEqual(candidate, parsed.data) ||
    parsed.data.scope !== "schedule.list" ||
    parsed.data.filterFingerprint !== filterFingerprint ||
    parsed.data.pageSize !== pageSize ||
    !isPaginationCursorTimeValid(parsed.data, now)
  ) {
    throw new OwnerScheduleReadContractError();
  }
  return parsed.data as AuthenticatedScheduleListCursor;
}

export function createOwnerScheduleListReadRequest(input: {
  readonly query: unknown;
  readonly cursorCodec: Pick<PaginationCursorCodec, "verify">;
  readonly now: Date;
}): OwnerScheduleListRequestResult {
  const querySnapshot = exactDataObjectWithOptionalKeys(
    input.query,
    ["fromDate", "toDate"],
    ["kind", "statuses", "pageSize", "cursor"],
  );
  if (!querySnapshot) throw new OwnerScheduleReadContractError();
  const queryCandidate = { ...querySnapshot };
  if (Object.hasOwn(queryCandidate, "statuses")) {
    const statuses = exactDenseArray(queryCandidate.statuses, 1, 5);
    if (!statuses) throw new OwnerScheduleReadContractError();
    queryCandidate.statuses = [...statuses];
  }
  const query = ScheduleListQuerySchema.parse(queryCandidate);
  const filters = canonicalFilters(query);
  const filterFingerprint = scheduleFingerprint(query);
  let after: OwnerScheduleListReadRequest["after"] = null;

  if (query.cursor !== undefined) {
    let cursor;
    try {
      cursor = verifyOwnerScheduleListCursor(
        input.cursorCodec,
        query.cursor,
        filterFingerprint,
        query.pageSize,
        input.now,
      );
    } catch {
      throw new OwnerScheduleReadContractError();
    }
    if (!cursor) {
      return Object.freeze({ ok: false, code: "INVALID_CURSOR" });
    }
    after = scheduleAfter(cursor);
  }

  const request = Object.freeze({
    ...filters,
    pageSize: query.pageSize,
    rowLimit: query.pageSize + 1,
    after,
    order: OWNER_SCHEDULE_LIST_ORDER,
    filterFingerprint,
  });
  issuedListRequests.add(request);
  return Object.freeze({
    ok: true,
    request,
  });
}

import "server-only";

import { isDeepStrictEqual } from "node:util";

import {
  VacationListQuerySchema,
  type VacationListQuery,
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

export const OWNER_VACATION_LIST_ORDER = Object.freeze([
  "startDate",
  "id",
] as const);

type AuthenticatedVacationListCursor = Extract<
  AuthenticatedPaginationCursor,
  { readonly scope: "vacations.list" }
>;

export interface OwnerVacationListReadRequest {
  readonly fromDate: string;
  readonly toDate: string;
  readonly pageSize: number;
  /** The repository must request one lookahead row to prove another page. */
  readonly rowLimit: number;
  readonly after: Readonly<{ startDate: string; id: string }> | null;
  readonly order: typeof OWNER_VACATION_LIST_ORDER;
  readonly filterFingerprint: string;
}

export type OwnerVacationListRequestResult =
  | Readonly<{ ok: true; request: Readonly<OwnerVacationListReadRequest> }>
  | Readonly<{ ok: false; code: "INVALID_CURSOR" }>;

export class OwnerVacationReadContractError extends Error {
  constructor() {
    super("Owner vacation read result violated its contract");
    this.name = "OwnerVacationReadContractError";
  }
}

const issuedRequests = new WeakSet<object>();

export function assertOwnerVacationListReadRequest(
  request: Readonly<OwnerVacationListReadRequest>,
): void {
  if (!issuedRequests.has(request)) throw new OwnerVacationReadContractError();
}

function vacationFingerprint(query: VacationListQuery): string {
  return createPaginationCursorFilterFingerprint({
    scope: "vacations.list",
    filters: { fromDate: query.fromDate, toDate: query.toDate },
  });
}

const vacationCursorFields = [
  "version",
  "scope",
  "filterFingerprint",
  "pageSize",
  "startDate",
  "id",
  "issuedAt",
  "expiresAt",
] as const;

export function verifyOwnerVacationListCursor(
  codec: Pick<PaginationCursorCodec, "verify">,
  token: unknown,
  filterFingerprint: string,
  pageSize: number,
  now: Date,
): AuthenticatedVacationListCursor | null {
  const verification = codec.verify({
    token,
    expectedScope: "vacations.list",
    filterFingerprint,
    pageSize,
    now,
  });
  const failure = exactDataObject(verification, ["ok", "code"]);
  if (failure?.ok === false && failure.code === "INVALID_CURSOR") return null;
  const success = exactDataObject(verification, ["ok", "cursor"]);
  const cursorSnapshot =
    success?.ok === true
      ? exactDataObject(success.cursor, vacationCursorFields)
      : null;
  if (!cursorSnapshot) throw new OwnerVacationReadContractError();
  const candidate = { ...cursorSnapshot };
  const parsed = PaginationCursorPayloadSchema.safeParse(candidate);
  if (
    !parsed.success ||
    !isDeepStrictEqual(candidate, parsed.data) ||
    parsed.data.scope !== "vacations.list" ||
    parsed.data.filterFingerprint !== filterFingerprint ||
    parsed.data.pageSize !== pageSize ||
    !isPaginationCursorTimeValid(parsed.data, now)
  ) {
    throw new OwnerVacationReadContractError();
  }
  return parsed.data as AuthenticatedVacationListCursor;
}

export function createOwnerVacationListReadRequest(input: {
  readonly query: unknown;
  readonly cursorCodec: Pick<PaginationCursorCodec, "verify">;
  readonly now: Date;
}): OwnerVacationListRequestResult {
  const querySnapshot = exactDataObjectWithOptionalKeys(
    input.query,
    ["fromDate", "toDate"],
    ["pageSize", "cursor"],
  );
  if (!querySnapshot) throw new OwnerVacationReadContractError();
  const queryCandidate = { ...querySnapshot };
  const parsedQuery = VacationListQuerySchema.safeParse(queryCandidate);
  if (
    !parsedQuery.success ||
    !isDeepStrictEqual(queryCandidate, parsedQuery.data)
  ) {
    throw new OwnerVacationReadContractError();
  }
  const query = parsedQuery.data;
  const filterFingerprint = vacationFingerprint(query);
  let after: OwnerVacationListReadRequest["after"] = null;

  if (query.cursor !== undefined) {
    let cursor;
    try {
      cursor = verifyOwnerVacationListCursor(
        input.cursorCodec,
        query.cursor,
        filterFingerprint,
        query.pageSize,
        input.now,
      );
    } catch {
      throw new OwnerVacationReadContractError();
    }
    if (!cursor) {
      return Object.freeze({ ok: false, code: "INVALID_CURSOR" });
    }
    after = Object.freeze({ startDate: cursor.startDate, id: cursor.id });
  }

  const request = Object.freeze({
    fromDate: query.fromDate,
    toDate: query.toDate,
    pageSize: query.pageSize,
    rowLimit: query.pageSize + 1,
    after,
    order: OWNER_VACATION_LIST_ORDER,
    filterFingerprint,
  });
  issuedRequests.add(request);
  return Object.freeze({ ok: true, request });
}

import "server-only";

import { isDeepStrictEqual } from "node:util";

import {
  OutboxListQuerySchema,
  type OutboxListQuery,
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
  exactDate,
  exactDenseArray,
} from "../exactData.ts";

export const OWNER_OUTBOX_LIST_ORDER = Object.freeze([
  Object.freeze({ field: "createdAt", direction: "desc" }),
  Object.freeze({ field: "id", direction: "desc" }),
] as const);

type OutboxStatus = NonNullable<OutboxListQuery["statuses"]>[number];
type AuthenticatedOutboxListCursor = Extract<
  AuthenticatedPaginationCursor,
  { readonly scope: "outbox.list" }
>;

export interface OwnerOutboxListReadRequest {
  readonly statuses: readonly OutboxStatus[];
  readonly pageSize: number;
  /** The executor must request this many rows to prove another page exists. */
  readonly rowLimit: number;
  readonly after: Readonly<{ createdAt: string; id: string }> | null;
  readonly order: typeof OWNER_OUTBOX_LIST_ORDER;
  readonly filterFingerprint: string;
}

export type OwnerOutboxListRequestResult =
  | Readonly<{ ok: true; request: Readonly<OwnerOutboxListReadRequest> }>
  | Readonly<{ ok: false; code: "INVALID_CURSOR" }>;

export class OwnerOutboxReadContractError extends Error {
  constructor() {
    super("Owner outbox read result violated its contract");
    this.name = "OwnerOutboxReadContractError";
  }
}

const issuedListRequests = new WeakSet<object>();

export function assertOwnerOutboxListReadRequest(
  request: Readonly<OwnerOutboxListReadRequest>,
): void {
  if (!issuedListRequests.has(request))
    throw new OwnerOutboxReadContractError();
}

function canonicalFilters(query: OutboxListQuery) {
  return Object.freeze({
    statuses: Object.freeze([...(query.statuses ?? [])].sort()),
  });
}

function outboxFingerprint(query: OutboxListQuery): string {
  return createPaginationCursorFilterFingerprint({
    scope: "outbox.list",
    filters: canonicalFilters(query),
  });
}

const outboxCursorFields = [
  "version",
  "scope",
  "filterFingerprint",
  "pageSize",
  "createdAt",
  "id",
  "issuedAt",
  "expiresAt",
] as const;

export function verifyOwnerOutboxListCursor(
  codec: Pick<PaginationCursorCodec, "verify">,
  token: unknown,
  filterFingerprint: string,
  pageSize: number,
  now: Date,
): AuthenticatedOutboxListCursor | null {
  const verification = codec.verify({
    token,
    expectedScope: "outbox.list",
    filterFingerprint,
    pageSize,
    now,
  });
  const failure = exactDataObject(verification, ["ok", "code"]);
  if (failure?.ok === false && failure.code === "INVALID_CURSOR") return null;
  const success = exactDataObject(verification, ["ok", "cursor"]);
  const cursorSnapshot =
    success?.ok === true
      ? exactDataObject(success.cursor, outboxCursorFields)
      : null;
  if (!cursorSnapshot) throw new OwnerOutboxReadContractError();
  const candidate = { ...cursorSnapshot };
  const parsed = PaginationCursorPayloadSchema.safeParse(candidate);
  if (
    !parsed.success ||
    !isDeepStrictEqual(candidate, parsed.data) ||
    parsed.data.scope !== "outbox.list" ||
    parsed.data.filterFingerprint !== filterFingerprint ||
    parsed.data.pageSize !== pageSize ||
    !isPaginationCursorTimeValid(parsed.data, now)
  ) {
    throw new OwnerOutboxReadContractError();
  }
  return parsed.data as AuthenticatedOutboxListCursor;
}

export function createOwnerOutboxListReadRequest(input: {
  readonly query: unknown;
  readonly cursorCodec: Pick<PaginationCursorCodec, "verify">;
  readonly now: Date;
}): OwnerOutboxListRequestResult {
  const querySnapshot = exactDataObjectWithOptionalKeys(
    input.query,
    [],
    ["statuses", "pageSize", "cursor"],
  );
  const now = exactDate(input.now);
  if (!querySnapshot || !now) throw new OwnerOutboxReadContractError();
  const queryCandidate = { ...querySnapshot };
  if (
    Object.hasOwn(queryCandidate, "statuses") &&
    queryCandidate.statuses !== undefined
  ) {
    const statuses = exactDenseArray(queryCandidate.statuses, 1, 7);
    if (!statuses) throw new OwnerOutboxReadContractError();
    queryCandidate.statuses = [...statuses];
  } else {
    delete queryCandidate.statuses;
  }
  const query = OutboxListQuerySchema.parse(queryCandidate);
  const filters = canonicalFilters(query);
  const filterFingerprint = outboxFingerprint(query);
  let after: OwnerOutboxListReadRequest["after"] = null;

  if (query.cursor !== undefined) {
    let cursor;
    try {
      cursor = verifyOwnerOutboxListCursor(
        input.cursorCodec,
        query.cursor,
        filterFingerprint,
        query.pageSize,
        now,
      );
    } catch {
      throw new OwnerOutboxReadContractError();
    }
    if (!cursor) return Object.freeze({ ok: false, code: "INVALID_CURSOR" });
    after = Object.freeze({ createdAt: cursor.createdAt, id: cursor.id });
  }

  const request = Object.freeze({
    ...filters,
    pageSize: query.pageSize,
    rowLimit: query.pageSize + 1,
    after,
    order: OWNER_OUTBOX_LIST_ORDER,
    filterFingerprint,
  });
  issuedListRequests.add(request);
  return Object.freeze({ ok: true, request });
}

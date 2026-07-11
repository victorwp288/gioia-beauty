import "server-only";

import { isDeepStrictEqual } from "node:util";

import {
  SubscriberListQuerySchema,
  type SubscriberListQuery,
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

export const OWNER_SUBSCRIBER_LIST_ORDER = Object.freeze([
  Object.freeze({ field: "createdAt", direction: "desc" }),
  Object.freeze({ field: "id", direction: "desc" }),
] as const);

type SubscriberStatus = NonNullable<SubscriberListQuery["statuses"]>[number];
type AuthenticatedSubscriberListCursor = Extract<
  AuthenticatedPaginationCursor,
  { readonly scope: "subscribers.list" }
>;

export interface OwnerSubscriberListReadRequest {
  readonly statuses: readonly SubscriberStatus[];
  readonly pageSize: number;
  /** The executor must request this many rows to prove another page exists. */
  readonly rowLimit: number;
  readonly after: Readonly<{ createdAt: string; id: string }> | null;
  readonly order: typeof OWNER_SUBSCRIBER_LIST_ORDER;
  readonly filterFingerprint: string;
}

export type OwnerSubscriberListRequestResult =
  | Readonly<{ ok: true; request: Readonly<OwnerSubscriberListReadRequest> }>
  | Readonly<{ ok: false; code: "INVALID_CURSOR" }>;

export class OwnerSubscriberReadContractError extends Error {
  constructor() {
    super("Owner subscriber read result violated its contract");
    this.name = "OwnerSubscriberReadContractError";
  }
}

const issuedListRequests = new WeakSet<object>();

export function assertOwnerSubscriberListReadRequest(
  request: Readonly<OwnerSubscriberListReadRequest>,
): void {
  if (!issuedListRequests.has(request)) {
    throw new OwnerSubscriberReadContractError();
  }
}

function canonicalFilters(query: SubscriberListQuery) {
  return Object.freeze({
    statuses: Object.freeze([...(query.statuses ?? [])].sort()),
  });
}

function subscriberFingerprint(query: SubscriberListQuery): string {
  return createPaginationCursorFilterFingerprint({
    scope: "subscribers.list",
    filters: canonicalFilters(query),
  });
}

const subscriberCursorFields = [
  "version",
  "scope",
  "filterFingerprint",
  "pageSize",
  "createdAt",
  "id",
  "issuedAt",
  "expiresAt",
] as const;

export function verifyOwnerSubscriberListCursor(
  codec: Pick<PaginationCursorCodec, "verify">,
  token: unknown,
  filterFingerprint: string,
  pageSize: number,
  now: Date,
): AuthenticatedSubscriberListCursor | null {
  const verification = codec.verify({
    token,
    expectedScope: "subscribers.list",
    filterFingerprint,
    pageSize,
    now,
  });
  const failure = exactDataObject(verification, ["ok", "code"]);
  if (failure?.ok === false && failure.code === "INVALID_CURSOR") return null;
  const success = exactDataObject(verification, ["ok", "cursor"]);
  const cursorSnapshot =
    success?.ok === true
      ? exactDataObject(success.cursor, subscriberCursorFields)
      : null;
  if (!cursorSnapshot) throw new OwnerSubscriberReadContractError();
  const candidate = { ...cursorSnapshot };
  const parsed = PaginationCursorPayloadSchema.safeParse(candidate);
  if (
    !parsed.success ||
    !isDeepStrictEqual(candidate, parsed.data) ||
    parsed.data.scope !== "subscribers.list" ||
    parsed.data.filterFingerprint !== filterFingerprint ||
    parsed.data.pageSize !== pageSize ||
    !isPaginationCursorTimeValid(parsed.data, now)
  ) {
    throw new OwnerSubscriberReadContractError();
  }
  return parsed.data as AuthenticatedSubscriberListCursor;
}

export function createOwnerSubscriberListReadRequest(input: {
  readonly query: unknown;
  readonly cursorCodec: Pick<PaginationCursorCodec, "verify">;
  readonly now: Date;
}): OwnerSubscriberListRequestResult {
  const querySnapshot = exactDataObjectWithOptionalKeys(
    input.query,
    [],
    ["statuses", "pageSize", "cursor"],
  );
  const now = exactDate(input.now);
  if (!querySnapshot || !now) throw new OwnerSubscriberReadContractError();
  const queryCandidate = { ...querySnapshot };
  if (
    Object.hasOwn(queryCandidate, "statuses") &&
    queryCandidate.statuses !== undefined
  ) {
    const statuses = exactDenseArray(queryCandidate.statuses, 1, 6);
    if (!statuses) throw new OwnerSubscriberReadContractError();
    queryCandidate.statuses = [...statuses];
  } else {
    delete queryCandidate.statuses;
  }
  const query = SubscriberListQuerySchema.parse(queryCandidate);
  const filters = canonicalFilters(query);
  const filterFingerprint = subscriberFingerprint(query);
  let after: OwnerSubscriberListReadRequest["after"] = null;

  if (query.cursor !== undefined) {
    let cursor;
    try {
      cursor = verifyOwnerSubscriberListCursor(
        input.cursorCodec,
        query.cursor,
        filterFingerprint,
        query.pageSize,
        now,
      );
    } catch {
      throw new OwnerSubscriberReadContractError();
    }
    if (!cursor) return Object.freeze({ ok: false, code: "INVALID_CURSOR" });
    after = Object.freeze({ createdAt: cursor.createdAt, id: cursor.id });
  }

  const request = Object.freeze({
    ...filters,
    pageSize: query.pageSize,
    rowLimit: query.pageSize + 1,
    after,
    order: OWNER_SUBSCRIBER_LIST_ORDER,
    filterFingerprint,
  });
  issuedListRequests.add(request);
  return Object.freeze({ ok: true, request });
}

import "server-only";

import { isDeepStrictEqual } from "node:util";

import {
  ScheduleCountQuerySchema,
  ScheduleCountResponseSchema,
  type ScheduleCountQuery,
} from "@/lib/domain/schemas/index.ts";

import {
  exactDataObject,
  exactDataObjectWithOptionalKeys,
  exactDenseArray,
} from "../exactData.ts";
import { OwnerScheduleReadContractError } from "./ownerScheduleReadContract.ts";

type ScheduleStatus = ScheduleCountQuery["statuses"] extends
  readonly (infer Status)[] | undefined
  ? Status
  : never;

export interface OwnerScheduleCountReadRequest {
  readonly fromDate: string;
  readonly toDate: string;
  readonly kind: "appointment" | "block" | null;
  readonly statuses: readonly ScheduleStatus[];
  /** Six valid kind/status groups plus one lookahead row. */
  readonly rowLimit: 7;
}

const issuedRequests = new WeakSet<object>();

export function assertOwnerScheduleCountReadRequest(
  request: Readonly<OwnerScheduleCountReadRequest>,
): void {
  if (!issuedRequests.has(request)) throw new OwnerScheduleReadContractError();
}

export function createOwnerScheduleCountReadRequest(
  queryInput: unknown,
): Readonly<OwnerScheduleCountReadRequest> {
  const querySnapshot = exactDataObjectWithOptionalKeys(
    queryInput,
    ["fromDate", "toDate"],
    ["kind", "statuses"],
  );
  if (!querySnapshot) throw new OwnerScheduleReadContractError();
  const queryCandidate = { ...querySnapshot };
  if (Object.hasOwn(queryCandidate, "statuses")) {
    const statuses = exactDenseArray(queryCandidate.statuses, 1, 5);
    if (!statuses) throw new OwnerScheduleReadContractError();
    queryCandidate.statuses = [...statuses];
  }
  const query = ScheduleCountQuerySchema.parse(queryCandidate);
  const request = Object.freeze({
    fromDate: query.fromDate,
    toDate: query.toDate,
    kind: query.kind ?? null,
    statuses: Object.freeze([...(query.statuses ?? [])].sort()),
    rowLimit: 7 as const,
  });
  issuedRequests.add(request);
  return request;
}

export function createOwnerScheduleCountResponse(
  request: Readonly<OwnerScheduleCountReadRequest>,
  groupsInput: unknown,
) {
  assertOwnerScheduleCountReadRequest(request);
  const groups = exactDenseArray(groupsInput, 0, 6);
  if (!groups) throw new OwnerScheduleReadContractError();
  const byKind = { appointment: 0, block: 0 };
  const byStatus = {
    confirmed: 0,
    completed: 0,
    cancelled: 0,
    noShow: 0,
    active: 0,
  };
  const seen = new Set<string>();
  let total = 0;

  for (const candidate of groups) {
    const group = exactDataObject(candidate, ["kind", "status", "count"]);
    if (!group) throw new OwnerScheduleReadContractError();
    const kind = group.kind;
    const status = group.status;
    const count = group.count;
    const validStatus =
      typeof status === "string" &&
      ((kind === "appointment" &&
        ["confirmed", "completed", "cancelled", "no_show"].includes(status)) ||
        (kind === "block" && ["active", "cancelled"].includes(status)));
    if (
      !validStatus ||
      typeof count !== "number" ||
      !Number.isInteger(count) ||
      count < 1 ||
      count > 2_147_483_647 ||
      (request.kind !== null && request.kind !== kind) ||
      (request.statuses.length > 0 &&
        !request.statuses.includes(status as ScheduleStatus))
    ) {
      throw new OwnerScheduleReadContractError();
    }
    const key = `${kind}:${status}`;
    if (seen.has(key)) throw new OwnerScheduleReadContractError();
    seen.add(key);
    if (total + count > 2_147_483_647) {
      throw new OwnerScheduleReadContractError();
    }
    total += count;
    byKind[kind as "appointment" | "block"] += count;
    const responseStatus = status === "no_show" ? "noShow" : status;
    byStatus[responseStatus as keyof typeof byStatus] += count;
  }

  const response = {
    fromDate: request.fromDate,
    toDate: request.toDate,
    total,
    byKind,
    byStatus,
  };
  const parsed = ScheduleCountResponseSchema.safeParse(response);
  if (!parsed.success || !isDeepStrictEqual(response, parsed.data)) {
    throw new OwnerScheduleReadContractError();
  }
  return Object.freeze({
    ...parsed.data,
    byKind: Object.freeze(parsed.data.byKind),
    byStatus: Object.freeze(parsed.data.byStatus),
  });
}

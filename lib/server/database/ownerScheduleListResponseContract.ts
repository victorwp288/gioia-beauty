import "server-only";

import { isDeepStrictEqual } from "node:util";

import {
  AdminScheduleEntryDtoSchema,
  AdminScheduleListResponseSchema,
  type AdminScheduleEntryDto,
} from "@/lib/domain/schemas/index.ts";
import type { PaginationCursorTokenWire } from "@/lib/domain/schemas/cursors.ts";

import { exactDataObject, exactDenseArray } from "../exactData.ts";
import type { PaginationCursorCodec } from "../paginationCursor.ts";
import {
  assertOwnerScheduleListReadRequest,
  OwnerScheduleReadContractError,
  type OwnerScheduleListReadRequest,
  verifyOwnerScheduleListCursor,
} from "./ownerScheduleReadContract.ts";

const dtoFields = [
  "id",
  "schemaVersion",
  "source",
  "date",
  "startMinutes",
  "serviceDurationMinutes",
  "bufferMinutes",
  "cancelledAt",
  "cancelledBy",
  "cancellationReason",
  "version",
  "createdAt",
  "updatedAt",
] as const;
const appointmentDtoFields = [
  ...dtoFields,
  "kind",
  "status",
  "serviceId",
  "variantId",
  "serviceNameSnapshot",
  "variantNameSnapshot",
  "priceCentsSnapshot",
  "currencySnapshot",
  "clientName",
  "clientEmail",
  "clientPhone",
  "clientNote",
  "internalNote",
] as const;
const blockDtoFields = [
  ...dtoFields,
  "kind",
  "status",
  "internalNote",
] as const;

function comparePosition(
  left: Readonly<{ date: string; startMinutes: number; id: string }>,
  right: Readonly<{ date: string; startMinutes: number; id: string }>,
): number {
  if (left.date !== right.date) return left.date < right.date ? -1 : 1;
  if (left.startMinutes !== right.startMinutes) {
    return left.startMinutes - right.startMinutes;
  }
  if (left.id === right.id) return 0;
  return left.id < right.id ? -1 : 1;
}

function canonicalRow(candidate: unknown): AdminScheduleEntryDto {
  const snapshot =
    exactDataObject(candidate, appointmentDtoFields) ??
    exactDataObject(candidate, blockDtoFields);
  if (!snapshot) throw new OwnerScheduleReadContractError();
  const exactCandidate = { ...snapshot };
  const parsed = AdminScheduleEntryDtoSchema.safeParse(exactCandidate);
  if (!parsed.success || !isDeepStrictEqual(exactCandidate, parsed.data)) {
    throw new OwnerScheduleReadContractError();
  }
  return Object.freeze(parsed.data);
}

function rowMatchesRequest(
  row: AdminScheduleEntryDto,
  request: OwnerScheduleListReadRequest,
): boolean {
  return (
    row.date >= request.fromDate &&
    row.date <= request.toDate &&
    (request.kind === null || row.kind === request.kind) &&
    (request.statuses.length === 0 || request.statuses.includes(row.status))
  );
}

export function createOwnerScheduleListResponse(input: {
  readonly request: Readonly<OwnerScheduleListReadRequest>;
  readonly rows: unknown;
  readonly cursorCodec: Pick<PaginationCursorCodec, "issue" | "verify">;
  readonly now: Date;
}): Readonly<{
  items: readonly AdminScheduleEntryDto[];
  nextCursor: PaginationCursorTokenWire | null;
}> {
  assertOwnerScheduleListReadRequest(input.request);
  const sourceRows = exactDenseArray(input.rows, 0, input.request.rowLimit);
  if (sourceRows === null) throw new OwnerScheduleReadContractError();
  const rows = sourceRows.map(canonicalRow);
  let previous = input.request.after;
  for (const row of rows) {
    if (
      !rowMatchesRequest(row, input.request) ||
      (previous !== null && comparePosition(previous, row) >= 0)
    ) {
      throw new OwnerScheduleReadContractError();
    }
    previous = row;
  }

  const hasNextPage = rows.length > input.request.pageSize;
  const items = rows.slice(0, input.request.pageSize);
  const finalItem = items.at(-1);
  let nextCursor: PaginationCursorTokenWire | null = null;
  if (hasNextPage && finalItem) {
    try {
      nextCursor = input.cursorCodec.issue({
        position: {
          scope: "schedule.list",
          date: finalItem.date,
          startMinutes: finalItem.startMinutes,
          id: finalItem.id,
        },
        filterFingerprint: input.request.filterFingerprint,
        pageSize: input.request.pageSize,
        now: input.now,
      });
      const issuedCursor = verifyOwnerScheduleListCursor(
        input.cursorCodec,
        nextCursor,
        input.request.filterFingerprint,
        input.request.pageSize,
        input.now,
      );
      if (!issuedCursor || comparePosition(issuedCursor, finalItem) !== 0) {
        throw new OwnerScheduleReadContractError();
      }
    } catch {
      throw new OwnerScheduleReadContractError();
    }
  }

  const response = { items, nextCursor };
  const parsed = AdminScheduleListResponseSchema.safeParse(response);
  if (!parsed.success || !isDeepStrictEqual(response, parsed.data)) {
    throw new OwnerScheduleReadContractError();
  }
  return Object.freeze({
    items: Object.freeze(parsed.data.items.map((item) => Object.freeze(item))),
    nextCursor: parsed.data.nextCursor,
  });
}

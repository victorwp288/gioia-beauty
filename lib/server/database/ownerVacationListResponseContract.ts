import "server-only";

import { isDeepStrictEqual } from "node:util";

import {
  AdminVacationDtoSchema,
  AdminVacationListResponseSchema,
  type AdminVacationDto,
} from "@/lib/domain/schemas/index.ts";
import type { PaginationCursorTokenWire } from "@/lib/domain/schemas/cursors.ts";

import { exactDataObject, exactDenseArray } from "../exactData.ts";
import type { PaginationCursorCodec } from "../paginationCursor.ts";
import {
  assertOwnerVacationListReadRequest,
  type OwnerVacationListReadRequest,
  OwnerVacationReadContractError,
  verifyOwnerVacationListCursor,
} from "./ownerVacationReadContract.ts";

const vacationDtoFields = [
  "id",
  "schemaVersion",
  "startDate",
  "endDate",
  "status",
  "reason",
  "source",
  "cancelledAt",
  "cancelledBy",
  "version",
  "createdAt",
  "updatedAt",
] as const;

function comparePosition(
  left: Readonly<{ startDate: string; id: string }>,
  right: Readonly<{ startDate: string; id: string }>,
): number {
  if (left.startDate !== right.startDate) {
    return left.startDate < right.startDate ? -1 : 1;
  }
  if (left.id === right.id) return 0;
  return left.id < right.id ? -1 : 1;
}

function canonicalRow(candidate: unknown): AdminVacationDto {
  const snapshot = exactDataObject(candidate, vacationDtoFields);
  if (!snapshot) throw new OwnerVacationReadContractError();
  const exactCandidate = { ...snapshot };
  const parsed = AdminVacationDtoSchema.safeParse(exactCandidate);
  if (!parsed.success || !isDeepStrictEqual(exactCandidate, parsed.data)) {
    throw new OwnerVacationReadContractError();
  }
  return Object.freeze(parsed.data);
}

function overlapsRequestedRange(
  vacation: AdminVacationDto,
  request: OwnerVacationListReadRequest,
): boolean {
  return (
    vacation.startDate <= request.toDate && vacation.endDate >= request.fromDate
  );
}

export function createOwnerVacationListResponse(input: {
  readonly request: Readonly<OwnerVacationListReadRequest>;
  readonly rows: unknown;
  readonly cursorCodec: Pick<PaginationCursorCodec, "issue" | "verify">;
  readonly now: Date;
}): Readonly<{
  items: readonly AdminVacationDto[];
  nextCursor: PaginationCursorTokenWire | null;
}> {
  assertOwnerVacationListReadRequest(input.request);
  const sourceRows = exactDenseArray(input.rows, 0, input.request.rowLimit);
  if (sourceRows === null) throw new OwnerVacationReadContractError();
  const rows = sourceRows.map(canonicalRow);
  let previous = input.request.after;
  for (const row of rows) {
    if (
      !overlapsRequestedRange(row, input.request) ||
      (previous !== null && comparePosition(previous, row) >= 0)
    ) {
      throw new OwnerVacationReadContractError();
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
          scope: "vacations.list",
          startDate: finalItem.startDate,
          id: finalItem.id,
        },
        filterFingerprint: input.request.filterFingerprint,
        pageSize: input.request.pageSize,
        now: input.now,
      });
      const issuedCursor = verifyOwnerVacationListCursor(
        input.cursorCodec,
        nextCursor,
        input.request.filterFingerprint,
        input.request.pageSize,
        input.now,
      );
      if (!issuedCursor || comparePosition(issuedCursor, finalItem) !== 0) {
        throw new OwnerVacationReadContractError();
      }
    } catch {
      throw new OwnerVacationReadContractError();
    }
  }

  const response = { items, nextCursor };
  const parsed = AdminVacationListResponseSchema.safeParse(response);
  if (!parsed.success || !isDeepStrictEqual(response, parsed.data)) {
    throw new OwnerVacationReadContractError();
  }
  return Object.freeze({
    items: Object.freeze(parsed.data.items.map((item) => Object.freeze(item))),
    nextCursor: parsed.data.nextCursor,
  });
}

import "server-only";

import { isDeepStrictEqual } from "node:util";

import {
  AdminOutboxDtoSchema,
  AdminOutboxListResponseSchema,
  PaginationCursorPositionSchema,
  type AdminOutboxDto,
} from "@/lib/domain/schemas/index.ts";
import type { PaginationCursorTokenWire } from "@/lib/domain/schemas/cursors.ts";

import { exactDataObject, exactDenseArray } from "../exactData.ts";
import type { PaginationCursorCodec } from "../paginationCursor.ts";
import {
  assertOwnerOutboxListReadRequest,
  OwnerOutboxReadContractError,
  type OwnerOutboxListReadRequest,
  verifyOwnerOutboxListCursor,
} from "./ownerOutboxReadContract.ts";

const dtoFields = [
  "id",
  "aggregateKind",
  "aggregateId",
  "aggregateVersion",
  "recipientKind",
  "recipientAddress",
  "templateKind",
  "status",
  "providerMessageId",
  "attemptCount",
  "nextAttemptAt",
  "lastErrorCode",
  "sentAt",
  "version",
  "createdAt",
  "updatedAt",
] as const;

const CURSOR_INSTANT_PATTERN =
  /^([1-9][0-9]{3}-[0-9]{2}-[0-9]{2}T(?:[01][0-9]|2[0-3]):[0-5][0-9]:[0-5][0-9])\.([0-9]{3})([0-9]{3})Z$/;

interface CanonicalOutboxRow {
  readonly item: AdminOutboxDto;
  readonly position: Readonly<{ createdAt: string; id: string }>;
}

function canonicalRow(candidate: unknown): CanonicalOutboxRow {
  const row = exactDataObject(candidate, ["cursorCreatedAt", "item"]);
  const itemSnapshot = row ? exactDataObject(row.item, dtoFields) : null;
  if (!row || !itemSnapshot) throw new OwnerOutboxReadContractError();
  const exactItem = { ...itemSnapshot };
  const parsedItem = AdminOutboxDtoSchema.safeParse(exactItem);
  if (
    !parsedItem.success ||
    !isDeepStrictEqual(exactItem, parsedItem.data) ||
    typeof row.cursorCreatedAt !== "string"
  ) {
    throw new OwnerOutboxReadContractError();
  }
  const position = {
    scope: "outbox.list" as const,
    createdAt: row.cursorCreatedAt,
    id: parsedItem.data.id,
  };
  const parsedPosition = PaginationCursorPositionSchema.safeParse(position);
  const match = CURSOR_INSTANT_PATTERN.exec(row.cursorCreatedAt);
  const dtoInstant = match ? `${match[1]}.${match[2]}Z` : null;
  if (
    !parsedPosition.success ||
    parsedPosition.data.scope !== "outbox.list" ||
    dtoInstant !== parsedItem.data.createdAt
  ) {
    throw new OwnerOutboxReadContractError();
  }
  return Object.freeze({
    item: Object.freeze(parsedItem.data),
    position: Object.freeze({
      createdAt: parsedPosition.data.createdAt,
      id: parsedPosition.data.id,
    }),
  });
}

function comparePosition(
  left: Readonly<{ createdAt: string; id: string }>,
  right: Readonly<{ createdAt: string; id: string }>,
): number {
  if (left.createdAt !== right.createdAt) {
    return left.createdAt < right.createdAt ? -1 : 1;
  }
  if (left.id === right.id) return 0;
  return left.id < right.id ? -1 : 1;
}

function rowMatchesRequest(
  row: CanonicalOutboxRow,
  request: OwnerOutboxListReadRequest,
): boolean {
  return (
    request.statuses.length === 0 || request.statuses.includes(row.item.status)
  );
}

export function createOwnerOutboxListResponse(input: {
  readonly request: Readonly<OwnerOutboxListReadRequest>;
  readonly rows: unknown;
  readonly cursorCodec: Pick<PaginationCursorCodec, "issue" | "verify">;
  readonly now: Date;
}): Readonly<{
  items: readonly AdminOutboxDto[];
  nextCursor: PaginationCursorTokenWire | null;
}> {
  assertOwnerOutboxListReadRequest(input.request);
  const sourceRows = exactDenseArray(input.rows, 0, input.request.rowLimit);
  if (!sourceRows) throw new OwnerOutboxReadContractError();
  const rows = sourceRows.map(canonicalRow);
  let previous = input.request.after;
  for (const row of rows) {
    if (
      !rowMatchesRequest(row, input.request) ||
      (previous !== null && comparePosition(previous, row.position) <= 0)
    ) {
      throw new OwnerOutboxReadContractError();
    }
    previous = row.position;
  }

  const hasNextPage = rows.length > input.request.pageSize;
  const emitted = rows.slice(0, input.request.pageSize);
  const finalRow = emitted.at(-1);
  let nextCursor: PaginationCursorTokenWire | null = null;
  if (hasNextPage && finalRow) {
    try {
      nextCursor = input.cursorCodec.issue({
        position: {
          scope: "outbox.list",
          createdAt: finalRow.position.createdAt,
          id: finalRow.position.id,
        },
        filterFingerprint: input.request.filterFingerprint,
        pageSize: input.request.pageSize,
        now: input.now,
      });
      const issuedCursor = verifyOwnerOutboxListCursor(
        input.cursorCodec,
        nextCursor,
        input.request.filterFingerprint,
        input.request.pageSize,
        input.now,
      );
      if (
        !issuedCursor ||
        comparePosition(issuedCursor, finalRow.position) !== 0
      ) {
        throw new OwnerOutboxReadContractError();
      }
    } catch {
      throw new OwnerOutboxReadContractError();
    }
  }

  const response = {
    items: emitted.map((row) => row.item),
    nextCursor,
  };
  const parsed = AdminOutboxListResponseSchema.safeParse(response);
  if (!parsed.success || !isDeepStrictEqual(response, parsed.data)) {
    throw new OwnerOutboxReadContractError();
  }
  return Object.freeze({
    items: Object.freeze(parsed.data.items.map((item) => Object.freeze(item))),
    nextCursor: parsed.data.nextCursor,
  });
}

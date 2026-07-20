import "server-only";

import { exactDataObject } from "../exactData.ts";
import type { DatabaseRow } from "./runtime.ts";

export class OwnerReadRepositoryResultError extends Error {
  constructor() {
    super("Owner read result violated its repository contract");
    this.name = "OwnerReadRepositoryResultError";
  }
}

function exactRow(
  candidate: DatabaseRow,
  fields: readonly string[],
): DatabaseRow {
  const row = exactDataObject(candidate, fields);
  if (!row) throw new OwnerReadRepositoryResultError();
  return row;
}

export function unwrapItemRows(
  rows: DatabaseRow[],
  maximumRows: number,
): unknown[] {
  if (rows.length > maximumRows) throw new OwnerReadRepositoryResultError();
  return rows.map((candidate) => exactRow(candidate, ["item"]).item);
}

export function unwrapCursorItemRows(
  rows: DatabaseRow[],
  maximumRows: number,
): Array<{ cursorCreatedAt: unknown; item: unknown }> {
  if (rows.length > maximumRows) throw new OwnerReadRepositoryResultError();
  return rows.map((candidate) => {
    const row = exactRow(candidate, ["cursor_created_at", "item"]);
    return {
      cursorCreatedAt: row.cursor_created_at,
      item: row.item,
    };
  });
}

export function exactCountRows(rows: DatabaseRow[]): DatabaseRow[] {
  if (rows.length > 7) throw new OwnerReadRepositoryResultError();
  return rows.map((candidate) =>
    exactRow(candidate, ["kind", "status", "count"]),
  );
}

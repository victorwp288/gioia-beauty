import "server-only";

import { isDeepStrictEqual } from "node:util";

import {
  AdminScheduleEntryDtoSchema,
  type AdminScheduleEntryDto,
} from "@/lib/domain/schemas/index.ts";
import type { PaginationCursorTokenWire } from "@/lib/domain/schemas/cursors.ts";

import { exactDataObject, exactDenseArray } from "../exactData.ts";
import type { PaginationCursorCodec } from "../paginationCursor.ts";
import {
  assertOwnerScheduleExportReadRequest,
  OwnerScheduleExportContractError,
  type OwnerScheduleExportReadRequest,
  verifyOwnerScheduleExportCursor,
} from "./ownerScheduleExportReadContract.ts";

export const MAX_OWNER_SCHEDULE_EXPORT_CSV_BYTES = 16 * 1_024 * 1_024;

const commonFields = [
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
const appointmentFields = [
  ...commonFields,
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
const blockFields = [
  ...commonFields,
  "kind",
  "status",
  "internalNote",
] as const;

const BASE_HEADERS = Object.freeze([
  "id",
  "schema_version",
  "kind",
  "status",
  "date",
  "start_time",
  "service_duration_minutes",
  "buffer_minutes",
  "occupied_end_time",
  "source",
  "service_id",
  "variant_id",
  "service_name",
  "variant_name",
  "price_cents",
  "currency",
  "client_name",
  "client_email",
  "client_phone",
  "cancelled_at",
  "cancelled_by",
  "version",
  "created_at",
  "updated_at",
] as const);
const NOTE_HEADERS = Object.freeze([
  "client_note",
  "internal_note",
  "cancellation_reason",
] as const);

export interface OwnerScheduleExportPage {
  readonly csv: string;
  readonly filename: string;
  readonly nextCursor: PaginationCursorTokenWire | null;
  readonly rowCount: number;
}

function canonicalRow(candidate: unknown): AdminScheduleEntryDto {
  const snapshot =
    exactDataObject(candidate, appointmentFields) ??
    exactDataObject(candidate, blockFields);
  if (!snapshot) throw new OwnerScheduleExportContractError();
  const exactCandidate = { ...snapshot };
  const parsed = AdminScheduleEntryDtoSchema.safeParse(exactCandidate);
  if (!parsed.success || !isDeepStrictEqual(exactCandidate, parsed.data)) {
    throw new OwnerScheduleExportContractError();
  }
  return Object.freeze(parsed.data);
}

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

function assertRowMatchesRequest(
  row: AdminScheduleEntryDto,
  request: OwnerScheduleExportReadRequest,
): void {
  if (row.date < request.fromDate || row.date > request.toDate) {
    throw new OwnerScheduleExportContractError();
  }
  if (
    !request.includeNotes &&
    (row.internalNote !== null ||
      row.cancellationReason !== null ||
      (row.kind === "appointment" && row.clientNote !== null))
  ) {
    // The executor must project note-bearing fields to null when not requested.
    throw new OwnerScheduleExportContractError();
  }
}

function minuteText(minutes: number): string {
  const hours = Math.floor(minutes / 60);
  const remainder = minutes % 60;
  return `${String(hours).padStart(2, "0")}:${String(remainder).padStart(2, "0")}`;
}

function spreadsheetSafe(value: string): string {
  if (/^[\t\r\n]/.test(value) || /^\s*[=+\-@]/.test(value)) return `'${value}`;
  return value;
}

function csvCell(value: string | number | null): string {
  if (value === null) return "";
  if (typeof value === "number") return String(value);
  const safe = spreadsheetSafe(value);
  return `"${safe.replaceAll('"', '""')}"`;
}

function csvValues(
  row: AdminScheduleEntryDto,
  includeNotes: boolean,
): readonly (string | number | null)[] {
  const appointment = row.kind === "appointment" ? row : null;
  const values: (string | number | null)[] = [
    row.id,
    row.schemaVersion,
    row.kind,
    row.status,
    row.date,
    minuteText(row.startMinutes),
    row.serviceDurationMinutes,
    row.bufferMinutes,
    minuteText(
      row.startMinutes + row.serviceDurationMinutes + row.bufferMinutes,
    ),
    row.source,
    appointment?.serviceId ?? null,
    appointment?.variantId ?? null,
    appointment?.serviceNameSnapshot ?? null,
    appointment?.variantNameSnapshot ?? null,
    appointment?.priceCentsSnapshot ?? null,
    appointment?.currencySnapshot ?? null,
    appointment?.clientName ?? null,
    appointment?.clientEmail ?? null,
    appointment?.clientPhone ?? null,
    row.cancelledAt,
    row.cancelledBy,
    row.version,
    row.createdAt,
    row.updatedAt,
  ];
  if (includeNotes) {
    values.push(
      appointment?.clientNote ?? null,
      row.internalNote,
      row.cancellationReason,
    );
  }
  return values;
}

function renderCsv(
  rows: readonly AdminScheduleEntryDto[],
  includeNotes: boolean,
): string {
  const headers = includeNotes
    ? [...BASE_HEADERS, ...NOTE_HEADERS]
    : BASE_HEADERS;
  const lines = [
    headers.map(csvCell).join(","),
    ...rows.map((row) => csvValues(row, includeNotes).map(csvCell).join(",")),
  ];
  const csv = `\uFEFF${lines.join("\r\n")}\r\n`;
  if (Buffer.byteLength(csv, "utf8") > MAX_OWNER_SCHEDULE_EXPORT_CSV_BYTES) {
    throw new OwnerScheduleExportContractError();
  }
  return csv;
}

export function createOwnerScheduleExportPage(input: {
  readonly request: Readonly<OwnerScheduleExportReadRequest>;
  readonly rows: unknown;
  readonly cursorCodec: Pick<PaginationCursorCodec, "issue" | "verify">;
  readonly now: Date;
}): Readonly<OwnerScheduleExportPage> {
  assertOwnerScheduleExportReadRequest(input.request);
  const sourceRows = exactDenseArray(input.rows, 0, input.request.rowLimit);
  if (sourceRows === null) throw new OwnerScheduleExportContractError();
  const rows = sourceRows.map(canonicalRow);

  let previous = input.request.after;
  for (const row of rows) {
    assertRowMatchesRequest(row, input.request);
    if (previous !== null && comparePosition(previous, row) >= 0) {
      throw new OwnerScheduleExportContractError();
    }
    previous = row;
  }

  const hasNextPage = rows.length > input.request.pageSize;
  const exportedRows = rows.slice(0, input.request.pageSize);
  const finalRow = exportedRows.at(-1);
  let nextCursor: PaginationCursorTokenWire | null = null;
  if (hasNextPage && finalRow) {
    try {
      nextCursor = input.cursorCodec.issue({
        position: {
          scope: "schedule.export",
          date: finalRow.date,
          startMinutes: finalRow.startMinutes,
          id: finalRow.id,
        },
        filterFingerprint: input.request.filterFingerprint,
        pageSize: input.request.pageSize,
        now: input.now,
      });
      const verified = verifyOwnerScheduleExportCursor(
        input.cursorCodec,
        nextCursor,
        input.request.filterFingerprint,
        input.request.pageSize,
        input.now,
      );
      if (!verified || comparePosition(verified, finalRow) !== 0) {
        throw new OwnerScheduleExportContractError();
      }
    } catch {
      throw new OwnerScheduleExportContractError();
    }
  }

  return Object.freeze({
    csv: renderCsv(exportedRows, input.request.includeNotes),
    filename: `gioia-beauty-schedule-${input.request.fromDate}_to_${input.request.toDate}.csv`,
    nextCursor,
    rowCount: exportedRows.length,
  });
}

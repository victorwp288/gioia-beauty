import "server-only";

import { createHash } from "node:crypto";

import type { z } from "zod";

import { daysBetweenSalonDates } from "@/lib/domain/booking/primitives.ts";
import { OutboxStatusSchema } from "@/lib/domain/schemas/outbox-persistence.ts";
import { SalonDateSchema } from "@/lib/domain/schemas/primitives.ts";
import {
  AppointmentStatusSchema,
  BlockStatusSchema,
} from "@/lib/domain/schemas/schedule.ts";
import { SubscriberStatusSchema } from "@/lib/domain/schemas/subscribers.ts";

import { exactDataObject, exactDenseArray } from "./exactData.ts";

const FINGERPRINT_DOMAIN = "gioia:pagination-filter:v1\0";

export type ScheduleCursorFilterStatus =
  z.infer<typeof AppointmentStatusSchema> | z.infer<typeof BlockStatusSchema>;

export type SubscriberCursorFilterStatus = z.infer<
  typeof SubscriberStatusSchema
>;

export type OutboxCursorFilterStatus = z.infer<typeof OutboxStatusSchema>;

/**
 * Omitted query defaults are materialized before hashing: absent schedule kind
 * is `null`, absent statuses are `[]`, export format is `csv`, and notes are
 * excluded. Pagination controls are absent because page size is independently
 * signed and the cursor itself is never a filter.
 */
export type PaginationCursorFilterFingerprintInput =
  | Readonly<{
      scope: "schedule.list";
      filters: Readonly<{
        fromDate: string;
        toDate: string;
        kind?: "appointment" | "block" | null;
        statuses?: readonly ScheduleCursorFilterStatus[];
      }>;
    }>
  | Readonly<{
      scope: "schedule.export";
      filters: Readonly<{
        fromDate: string;
        toDate: string;
        format?: "csv";
        includeNotes?: boolean;
      }>;
    }>
  | Readonly<{
      scope: "vacations.list";
      filters: Readonly<{ fromDate: string; toDate: string }>;
    }>
  | Readonly<{
      scope: "subscribers.list";
      filters: Readonly<{
        statuses?: readonly SubscriberCursorFilterStatus[];
      }>;
    }>
  | Readonly<{
      scope: "outbox.list";
      filters: Readonly<{ statuses?: readonly OutboxCursorFilterStatus[] }>;
    }>;

export class PaginationCursorFingerprintInputError extends Error {
  constructor() {
    super("Pagination cursor fingerprint input is invalid");
    this.name = "PaginationCursorFingerprintInputError";
  }
}

type CanonicalFilterFingerprintInput = PaginationCursorFilterFingerprintInput;
type ScheduleListFingerprintInput = Extract<
  PaginationCursorFilterFingerprintInput,
  { scope: "schedule.list" }
>;
type ScheduleExportFingerprintInput = Extract<
  PaginationCursorFilterFingerprintInput,
  { scope: "schedule.export" }
>;

function canonicalDateRangeFromSnapshot(
  filters: Readonly<Record<string, unknown>>,
  maximumDays: number,
): Readonly<{ fromDate: string; toDate: string }> | null {
  const fromDate = SalonDateSchema.safeParse(filters.fromDate);
  const toDate = SalonDateSchema.safeParse(filters.toDate);
  if (!fromDate.success || !toDate.success) return null;
  const days = daysBetweenSalonDates(fromDate.data, toDate.data);
  if (days < 0 || days > maximumDays) return null;
  return Object.freeze({ fromDate: fromDate.data, toDate: toDate.data });
}

function exactDataObjectVariant(
  candidate: unknown,
  keySets: readonly (readonly string[])[],
): Readonly<Record<string, unknown>> | null {
  for (const keys of keySets) {
    const snapshot = exactDataObject(candidate, keys);
    if (snapshot) return snapshot;
  }
  return null;
}

function canonicalStatuses<Status extends string>(
  candidate: unknown,
  maximumLength: number,
  isStatus: (value: unknown) => value is Status,
): readonly Status[] | null {
  const statuses = exactDenseArray(candidate, 0, maximumLength);
  if (!statuses) return null;

  const unique = new Set<string>();
  const canonical: Status[] = [];
  for (const status of statuses) {
    if (typeof status !== "string" || !isStatus(status) || unique.has(status)) {
      return null;
    }
    unique.add(status);
    canonical.push(status);
  }
  canonical.sort();
  return Object.freeze(canonical);
}

function canonicalScheduleListFilters(
  candidate: unknown,
): ScheduleListFingerprintInput["filters"] | null {
  const filterSnapshot = exactDataObjectVariant(candidate, [
    ["fromDate", "toDate"],
    ["fromDate", "toDate", "kind"],
    ["fromDate", "toDate", "statuses"],
    ["fromDate", "toDate", "kind", "statuses"],
  ]);
  if (!filterSnapshot) return null;
  const range = canonicalDateRangeFromSnapshot(filterSnapshot, 31);
  if (!range) return null;
  const kind = Object.hasOwn(filterSnapshot, "kind")
    ? filterSnapshot.kind
    : null;
  if (kind !== null && kind !== "appointment" && kind !== "block") {
    return null;
  }
  const statuses = canonicalStatuses(
    Object.hasOwn(filterSnapshot, "statuses") ? filterSnapshot.statuses : [],
    5,
    (value): value is ScheduleCursorFilterStatus =>
      AppointmentStatusSchema.safeParse(value).success ||
      BlockStatusSchema.safeParse(value).success,
  );
  if (!statuses) return null;
  if (kind === "appointment" && statuses.includes("active")) {
    return null;
  }
  if (
    kind === "block" &&
    statuses.some((status) =>
      ["completed", "confirmed", "no_show"].includes(status),
    )
  ) {
    return null;
  }
  return Object.freeze({
    fromDate: range.fromDate,
    toDate: range.toDate,
    kind,
    statuses,
  });
}

function canonicalExportFilters(
  candidate: unknown,
): ScheduleExportFingerprintInput["filters"] | null {
  const filters = exactDataObjectVariant(candidate, [
    ["fromDate", "toDate"],
    ["fromDate", "toDate", "format"],
    ["fromDate", "toDate", "includeNotes"],
    ["fromDate", "toDate", "format", "includeNotes"],
  ]);
  if (!filters) return null;
  const range = canonicalDateRangeFromSnapshot(filters, 365);
  const format = Object.hasOwn(filters, "format") ? filters.format : "csv";
  const includeNotes = Object.hasOwn(filters, "includeNotes")
    ? filters.includeNotes
    : false;
  if (!range || format !== "csv" || typeof includeNotes !== "boolean") {
    return null;
  }
  return Object.freeze({
    fromDate: range.fromDate,
    toDate: range.toDate,
    format: "csv" as const,
    includeNotes,
  });
}

function canonicalStatusFilters<Status extends string>(
  candidate: unknown,
  maximumLength: number,
  isStatus: (value: unknown) => value is Status,
): Readonly<{ statuses: readonly Status[] }> | null {
  const filters = exactDataObjectVariant(candidate, [[], ["statuses"]]);
  if (!filters) return null;
  const statuses = canonicalStatuses(
    Object.hasOwn(filters, "statuses") ? filters.statuses : [],
    maximumLength,
    isStatus,
  );
  return statuses ? Object.freeze({ statuses }) : null;
}

function canonicalInput(
  candidate: unknown,
): CanonicalFilterFingerprintInput | null {
  const input = exactDataObject(candidate, ["scope", "filters"]);
  if (!input) return null;

  switch (input.scope) {
    case "schedule.list": {
      const filters = canonicalScheduleListFilters(input.filters);
      return filters ? { scope: input.scope, filters } : null;
    }
    case "schedule.export": {
      const filters = canonicalExportFilters(input.filters);
      return filters ? { scope: input.scope, filters } : null;
    }
    case "vacations.list": {
      const snapshot = exactDataObject(input.filters, ["fromDate", "toDate"]);
      const filters = snapshot
        ? canonicalDateRangeFromSnapshot(snapshot, 365)
        : null;
      return filters ? { scope: input.scope, filters } : null;
    }
    case "subscribers.list": {
      const filters = canonicalStatusFilters(
        input.filters,
        6,
        (value): value is SubscriberCursorFilterStatus =>
          SubscriberStatusSchema.safeParse(value).success,
      );
      return filters ? { scope: input.scope, filters } : null;
    }
    case "outbox.list": {
      const filters = canonicalStatusFilters(
        input.filters,
        7,
        (value): value is OutboxCursorFilterStatus =>
          OutboxStatusSchema.safeParse(value).success,
      );
      return filters ? { scope: input.scope, filters } : null;
    }
    default:
      return null;
  }
}

export function createPaginationCursorFilterFingerprint(
  input: unknown,
): string {
  let canonical: CanonicalFilterFingerprintInput | null = null;
  try {
    canonical = canonicalInput(input);
  } catch {
    // Collapse every hostile input shape to one fixed boundary error.
  }
  if (!canonical) throw new PaginationCursorFingerprintInputError();

  return createHash("sha256")
    .update(FINGERPRINT_DOMAIN, "utf8")
    .update(JSON.stringify(canonical), "utf8")
    .digest("hex");
}

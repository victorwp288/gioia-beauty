import { z } from "zod";

import {
  AvailabilityQuerySchema,
  OutboxListQuerySchema,
  ScheduleCountQuerySchema,
  ScheduleExportQuerySchema,
  ScheduleListQuerySchema,
  SubscriberListQuerySchema,
  VacationListQuerySchema,
} from "./queries.ts";

function queryError(key: string, message: string): never {
  throw new z.ZodError([
    {
      code: z.ZodIssueCode.custom,
      path: [key],
      message,
    },
  ]);
}

function assertKnownKeys(searchParams: URLSearchParams, allowed: string[]) {
  const known = new Set(allowed);
  for (const key of searchParams.keys()) {
    if (!known.has(key)) queryError(key, "Unknown query parameter");
  }
}

function singleValue(searchParams: URLSearchParams, key: string) {
  const values = searchParams.getAll(key);
  if (values.length > 1) queryError(key, "Query parameter must appear once");
  return values[0];
}

function integerValue(searchParams: URLSearchParams, key: string) {
  const value = singleValue(searchParams, key);
  if (value === undefined) return undefined;
  if (!/^(0|[1-9]\d*)$/.test(value)) {
    queryError(key, "Query parameter must be a canonical nonnegative integer");
  }
  const number = Number(value);
  if (!Number.isSafeInteger(number)) queryError(key, "Integer is out of range");
  return number;
}

function booleanValue(searchParams: URLSearchParams, key: string) {
  const value = singleValue(searchParams, key);
  if (value === undefined) return undefined;
  if (value !== "true" && value !== "false") {
    queryError(key, "Query parameter must be exactly true or false");
  }
  return value === "true";
}

function repeatedValues(searchParams: URLSearchParams, key: string) {
  const values = searchParams.getAll(key);
  return values.length === 0 ? undefined : values;
}

function assignIfPresent(
  target: Record<string, unknown>,
  key: string,
  value: unknown,
) {
  if (value !== undefined) target[key] = value;
}

function dateRangeValues(searchParams: URLSearchParams) {
  return {
    fromDate: singleValue(searchParams, "fromDate"),
    toDate: singleValue(searchParams, "toDate"),
  };
}

function paginationValues(searchParams: URLSearchParams) {
  const values: Record<string, unknown> = {};
  assignIfPresent(values, "pageSize", integerValue(searchParams, "pageSize"));
  assignIfPresent(values, "cursor", singleValue(searchParams, "cursor"));
  return values;
}

function scheduleFilterValues(searchParams: URLSearchParams) {
  const values: Record<string, unknown> = {};
  assignIfPresent(values, "kind", singleValue(searchParams, "kind"));
  assignIfPresent(values, "statuses", repeatedValues(searchParams, "status"));
  return values;
}

const SCHEDULE_KEYS = [
  "fromDate",
  "toDate",
  "kind",
  "status",
  "pageSize",
  "cursor",
];

export function parseAvailabilitySearchParams(searchParams: URLSearchParams) {
  assertKnownKeys(searchParams, ["date", "serviceId", "variantId"]);
  return AvailabilityQuerySchema.parse({
    date: singleValue(searchParams, "date"),
    serviceId: singleValue(searchParams, "serviceId"),
    variantId: singleValue(searchParams, "variantId"),
  });
}

export function parseScheduleListSearchParams(searchParams: URLSearchParams) {
  assertKnownKeys(searchParams, SCHEDULE_KEYS);
  return ScheduleListQuerySchema.parse({
    ...dateRangeValues(searchParams),
    ...scheduleFilterValues(searchParams),
    ...paginationValues(searchParams),
  });
}

export function parseScheduleCountSearchParams(searchParams: URLSearchParams) {
  const allowed = SCHEDULE_KEYS.filter(
    (key) => key !== "pageSize" && key !== "cursor",
  );
  assertKnownKeys(searchParams, allowed);
  return ScheduleCountQuerySchema.parse({
    ...dateRangeValues(searchParams),
    ...scheduleFilterValues(searchParams),
  });
}

export function parseScheduleExportSearchParams(searchParams: URLSearchParams) {
  const allowed = [
    "fromDate",
    "toDate",
    "format",
    "includeNotes",
    "pageSize",
    "cursor",
  ];
  assertKnownKeys(searchParams, allowed);
  const values: Record<string, unknown> = {
    ...dateRangeValues(searchParams),
    ...paginationValues(searchParams),
  };
  assignIfPresent(values, "format", singleValue(searchParams, "format"));
  assignIfPresent(
    values,
    "includeNotes",
    booleanValue(searchParams, "includeNotes"),
  );
  return ScheduleExportQuerySchema.parse(values);
}

export function parseVacationListSearchParams(searchParams: URLSearchParams) {
  assertKnownKeys(searchParams, ["fromDate", "toDate", "pageSize", "cursor"]);
  return VacationListQuerySchema.parse({
    ...dateRangeValues(searchParams),
    ...paginationValues(searchParams),
  });
}

function parseStatusPageSearchParams(
  searchParams: URLSearchParams,
  schema: typeof SubscriberListQuerySchema | typeof OutboxListQuerySchema,
) {
  assertKnownKeys(searchParams, ["status", "pageSize", "cursor"]);
  return schema.parse({
    statuses: repeatedValues(searchParams, "status"),
    ...paginationValues(searchParams),
  });
}

export function parseSubscriberListSearchParams(searchParams: URLSearchParams) {
  return parseStatusPageSearchParams(searchParams, SubscriberListQuerySchema);
}

export function parseOutboxListSearchParams(searchParams: URLSearchParams) {
  return parseStatusPageSearchParams(searchParams, OutboxListQuerySchema);
}

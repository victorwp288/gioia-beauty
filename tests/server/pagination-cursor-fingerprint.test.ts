import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import {
  PaginationCursorFingerprintInputError,
  createPaginationCursorFilterFingerprint,
} from "@/lib/server/paginationCursorFingerprint.ts";

const SCHEDULE_FILTERS = Object.freeze({
  fromDate: "2026-07-01",
  toDate: "2026-07-31",
  kind: null,
  statuses: Object.freeze(["confirmed", "active"]),
});

function scheduleInput(filters: unknown = SCHEDULE_FILTERS): {
  scope: string;
  filters: unknown;
} {
  return { scope: "schedule.list", filters };
}

function caughtInputError(candidate: unknown): unknown {
  try {
    createPaginationCursorFilterFingerprint(candidate);
  } catch (error) {
    return error;
  }
  return null;
}

function expectFixedInputError(candidate: unknown): void {
  const error = caughtInputError(candidate);
  expect(error).toEqual(new PaginationCursorFingerprintInputError());
  expect(String(error)).toBe(
    "PaginationCursorFingerprintInputError: Pagination cursor fingerprint input is invalid",
  );
}

describe("pagination cursor filter fingerprint", () => {
  it.each([
    [
      "schedule.list",
      scheduleInput(),
      "a8fe109fcf9f56050bbed9a531416ba1684eb49e424ada93546fbc2ff5e4490a",
    ],
    [
      "schedule.export",
      {
        filters: {
          includeNotes: false,
          format: "csv",
          toDate: "2026-12-31",
          fromDate: "2026-01-01",
        },
        scope: "schedule.export",
      },
      "c26aff6e8ddcf5a5f11d02068a59897bffd864bc50b3ab11f3cc4983cceb92e5",
    ],
    [
      "vacations.list",
      {
        filters: { toDate: "2026-12-31", fromDate: "2026-01-01" },
        scope: "vacations.list",
      },
      "e05b9811d8a3640c5be88233271813be5c0a0fd30d30b8c7e7c9412c95bbcd71",
    ],
    [
      "subscribers.list",
      { filters: { statuses: [] }, scope: "subscribers.list" },
      "49fecd27376e0cad54772d5729ed08516302cbaecc4bdc1cb7ac205872f2caa6",
    ],
    [
      "outbox.list",
      {
        filters: { statuses: ["pending", "failed"] },
        scope: "outbox.list",
      },
      "54d82b97a9d3318c6b5e7ec9479242ffabe61352004997438ba2ac586f07032e",
    ],
  ])("uses the canonical v1 SHA-256 vector for %s", (_scope, input, hash) => {
    expect(createPaginationCursorFilterFingerprint(input)).toBe(hash);
  });

  it("sorts status sets while preserving semantic filter changes", () => {
    const first = createPaginationCursorFilterFingerprint(scheduleInput());
    const reordered = createPaginationCursorFilterFingerprint(
      scheduleInput({
        ...SCHEDULE_FILTERS,
        statuses: ["active", "confirmed"],
      }),
    );
    const changed = createPaginationCursorFilterFingerprint(
      scheduleInput({ ...SCHEDULE_FILTERS, statuses: ["confirmed"] }),
    );

    expect(reordered).toBe(first);
    expect(changed).not.toBe(first);
  });

  it("canonicalizes omitted query defaults to their explicit values", () => {
    const explicitSchedule = scheduleInput({
      fromDate: "2026-07-01",
      toDate: "2026-07-31",
      kind: null,
      statuses: [],
    });
    expect(
      createPaginationCursorFilterFingerprint(
        scheduleInput({ fromDate: "2026-07-01", toDate: "2026-07-31" }),
      ),
    ).toBe(createPaginationCursorFilterFingerprint(explicitSchedule));

    const explicitExport = {
      scope: "schedule.export",
      filters: {
        fromDate: "2026-01-01",
        toDate: "2026-01-31",
        format: "csv",
        includeNotes: false,
      },
    };
    expect(
      createPaginationCursorFilterFingerprint({
        scope: "schedule.export",
        filters: {
          fromDate: "2026-01-01",
          toDate: "2026-01-31",
        },
      }),
    ).toBe(createPaginationCursorFilterFingerprint(explicitExport));
    expect(
      createPaginationCursorFilterFingerprint({
        scope: "subscribers.list",
        filters: {},
      }),
    ).toBe(
      createPaginationCursorFilterFingerprint({
        scope: "subscribers.list",
        filters: { statuses: [] },
      }),
    );
    expect(
      createPaginationCursorFilterFingerprint({
        scope: "outbox.list",
        filters: {},
      }),
    ).toBe(
      createPaginationCursorFilterFingerprint({
        scope: "outbox.list",
        filters: { statuses: [] },
      }),
    );

    for (const candidate of [
      scheduleInput({
        fromDate: "2026-07-01",
        toDate: "2026-07-31",
        kind: undefined,
      }),
      {
        scope: "schedule.export",
        filters: {
          fromDate: "2026-01-01",
          toDate: "2026-01-31",
          includeNotes: undefined,
        },
      },
      { scope: "subscribers.list", filters: { statuses: undefined } },
      { scope: "outbox.list", filters: { statuses: undefined } },
    ]) {
      expectFixedInputError(candidate);
    }
  });

  it("keeps cursor and page size outside the exact filter projection", () => {
    for (const candidate of [
      { ...scheduleInput(), pageSize: 50 },
      { ...scheduleInput(), cursor: "opaque" },
      scheduleInput({ ...SCHEDULE_FILTERS, pageSize: 50 }),
      scheduleInput({ ...SCHEDULE_FILTERS, cursor: "opaque" }),
    ]) {
      expectFixedInputError(candidate);
    }
  });

  it.each([
    scheduleInput({
      ...SCHEDULE_FILTERS,
      statuses: ["confirmed", "confirmed"],
    }),
    scheduleInput({ ...SCHEDULE_FILTERS, statuses: ["unknown"] }),
    scheduleInput({
      ...SCHEDULE_FILTERS,
      kind: "appointment",
      statuses: ["active"],
    }),
    scheduleInput({
      ...SCHEDULE_FILTERS,
      kind: "block",
      statuses: ["completed"],
    }),
    { scope: "subscribers.list", filters: { statuses: ["sent"] } },
    { scope: "outbox.list", filters: { statuses: ["unsubscribed"] } },
  ])(
    "rejects duplicate, cross-domain, or kind-invalid statuses %#",
    (input) => {
      expectFixedInputError(input);
    },
  );

  it("accepts exact inclusive range bounds and rejects invalid ranges", () => {
    expect(() =>
      createPaginationCursorFilterFingerprint(
        scheduleInput({
          ...SCHEDULE_FILTERS,
          fromDate: "2026-01-01",
          toDate: "2026-02-01",
        }),
      ),
    ).not.toThrow();
    expect(() =>
      createPaginationCursorFilterFingerprint({
        scope: "vacations.list",
        filters: { fromDate: "2026-01-01", toDate: "2027-01-01" },
      }),
    ).not.toThrow();

    for (const candidate of [
      scheduleInput({
        ...SCHEDULE_FILTERS,
        fromDate: "2026-01-01",
        toDate: "2026-02-02",
      }),
      scheduleInput({
        ...SCHEDULE_FILTERS,
        fromDate: "2026-02-01",
        toDate: "2026-01-01",
      }),
      scheduleInput({ ...SCHEDULE_FILTERS, fromDate: "2026-02-30" }),
      {
        scope: "schedule.export",
        filters: {
          fromDate: "2026-01-01",
          toDate: "2027-01-02",
          format: "csv",
          includeNotes: false,
        },
      },
      {
        scope: "vacations.list",
        filters: { fromDate: "2026-01-01", toDate: "2027-01-02" },
      },
    ]) {
      expectFixedInputError(candidate);
    }
  });
});

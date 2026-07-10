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

function scheduleInput(filters: unknown = SCHEDULE_FILTERS) {
  return { scope: "schedule.list", filters };
}

function expectFixedInputError(candidate: unknown): void {
  let caught: unknown;
  try {
    createPaginationCursorFilterFingerprint(candidate);
  } catch (error) {
    caught = error;
  }
  expect(caught).toEqual(new PaginationCursorFingerprintInputError());
  expect(String(caught)).toBe(
    "PaginationCursorFingerprintInputError: Pagination cursor fingerprint input is invalid",
  );
}

describe("pagination cursor fingerprint hostile boundaries", () => {
  it("rejects hostile objects without invoking accessors", () => {
    let getterCalls = 0;
    const accessorOuter = Object.defineProperty({}, "scope", {
      enumerable: true,
      get() {
        getterCalls += 1;
        return "schedule.list";
      },
    });
    Object.defineProperty(accessorOuter, "filters", {
      enumerable: true,
      value: SCHEDULE_FILTERS,
    });
    const accessorFilters = Object.defineProperty(
      {
        fromDate: "2026-07-01",
        toDate: "2026-07-31",
        kind: null,
      },
      "statuses",
      {
        enumerable: true,
        get() {
          getterCalls += 1;
          return [];
        },
      },
    );
    const { proxy: revoked, revoke } = Proxy.revocable(scheduleInput(), {});
    revoke();

    class FingerprintInput {
      scope = "schedule.list";
      filters = SCHEDULE_FILTERS;
    }

    for (const candidate of [
      accessorOuter,
      scheduleInput(accessorFilters),
      new FingerprintInput(),
      Object.create(scheduleInput()),
      { ...scheduleInput(), [Symbol("extra")]: true },
      Object.defineProperty(scheduleInput(), "extra", { value: true }),
      new Proxy(scheduleInput(), {}),
      revoked,
    ]) {
      expectFixedInputError(candidate);
    }
    expect(getterCalls).toBe(0);
  });

  it("rejects sparse, accessor, proxy, and decorated status arrays", () => {
    let getterCalls = 0;
    const accessorStatuses = Object.defineProperty([], "0", {
      enumerable: true,
      get() {
        getterCalls += 1;
        return "confirmed";
      },
    });
    const sparse = Array(1);
    const decorated = Object.assign(["confirmed"], { extra: true });

    for (const statuses of [
      accessorStatuses,
      sparse,
      decorated,
      Object.assign(["confirmed"], { [Symbol("extra")]: true }),
      new Proxy(["confirmed"], {}),
    ]) {
      expectFixedInputError(scheduleInput({ ...SCHEDULE_FILTERS, statuses }));
    }
    expect(getterCalls).toBe(0);
  });

  it("accepts exact null-prototype data objects", () => {
    const filters = Object.assign(Object.create(null) as object, {
      fromDate: "2026-07-01",
      toDate: "2026-07-31",
      kind: null,
      statuses: [],
    });
    const input = Object.assign(Object.create(null) as object, {
      scope: "schedule.list",
      filters,
    });

    expect(createPaginationCursorFilterFingerprint(input)).toMatch(
      /^[a-f0-9]{64}$/,
    );
  });
});

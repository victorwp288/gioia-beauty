import { describe, expect, it } from "vitest";

import {
  assertConcurrencyResults,
  bookingQuery,
  parseRaceTarget,
  raceTargetQuery,
} from "../../scripts/test-booking-concurrency.mjs";

function successfulReconciliation(overrides = {}) {
  return {
    appointments: 1,
    outbox_rows: 2,
    command_rows: 20,
    completed_commands: 1,
    failed_commands: 19,
    ...overrides,
  };
}

describe("booking concurrency reconciliation", () => {
  it("builds a bounded race through the restricted runtime role", () => {
    const target = {
      local_date: "2035-08-13",
      service_id: "manicure",
      variant_id: "manicure-30-min",
    };

    expect(raceTargetQuery).toContain("generate_series(1, 14)");
    expect(raceTargetQuery).toContain("local_date::text as local_date");
    expect(raceTargetQuery).toContain("extract(");
    expect(raceTargetQuery).not.toContain("pg_catalog.extract");
    expect(raceTargetQuery).not.toContain("gioia_private.rome_today");
    expect(bookingQuery(1, parseRaceTarget(target))).toContain(
      "set role app_runtime;",
    );
    expect(() =>
      parseRaceTarget({ ...target, service_id: "unsafe'; select" }),
    ).toThrow("invalid identifiers");
  });

  it("accepts exactly one winner and nineteen persisted conflicts", () => {
    const results = [
      { http_status: 201, code: "BOOKING_CREATED", replayed: false },
      ...Array.from({ length: 19 }, () => ({
        http_status: 409,
        code: "SLOT_UNAVAILABLE",
        replayed: false,
      })),
    ];

    expect(
      assertConcurrencyResults(results, successfulReconciliation()),
    ).toEqual({
      accepted: 1,
      conflicts: 19,
      appointments: 1,
      outbox: 2,
      commands: 20,
    });
  });

  it("rejects multiple winners or reconciliation drift", () => {
    const twoWinners = Array.from({ length: 20 }, (_, index) => ({
      http_status: index < 2 ? 201 : 409,
      code: index < 2 ? "BOOKING_CREATED" : "SLOT_UNAVAILABLE",
      replayed: false,
    }));

    expect(() =>
      assertConcurrencyResults(twoWinners, successfulReconciliation()),
    ).toThrow("Exactly one booking");
    expect(() =>
      assertConcurrencyResults(
        [
          { http_status: 201, code: "BOOKING_CREATED", replayed: false },
          ...Array.from({ length: 19 }, () => ({
            http_status: 409,
            code: "SLOT_UNAVAILABLE",
            replayed: false,
          })),
        ],
        successfulReconciliation({ appointments: 2 }),
      ),
    ).toThrow("reconciliation failed");
  });
});

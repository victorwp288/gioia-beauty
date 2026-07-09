import { describe, expect, it } from "vitest";

import { assertConcurrencyResults } from "../../scripts/test-booking-concurrency.mjs";

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

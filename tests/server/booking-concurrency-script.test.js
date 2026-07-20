import { readFileSync } from "node:fs";

import { describe, expect, it, vi } from "vitest";

import {
  assertBookingVacationRace,
  assertConcurrencyResults,
  assertIdenticalKeyReplayRace,
  assertOppositeRescheduleRace,
  BARRIER_WAITERS_SQL,
  bookingQuery,
  bookingVacationBookingQuery,
  bookingVacationVacationQuery,
  COORDINATOR_BARRIER_SQL,
  DATABASE_POOL_SIZE,
  identicalBookingQuery,
  oppositeRescheduleReconciliationQuery,
  ownerCreateAppointmentQuery,
  ownerRescheduleQuery,
  parseBarrierWaiterCount,
  parseCreatedAppointment,
  parseLocalDatabaseUrl,
  parseRaceTarget,
  parseRaceTargets,
  raceTargetQuery,
  RUNTIME_ROLE_SQL,
  runBookingConcurrencySuite,
  WORKER_BARRIER_SQL,
} from "../../scripts/test-booking-concurrency.mjs";

const target = {
  local_date: "2035-08-13",
  service_id: "manicure",
  variant_id: "manicure-30-min",
};
const parsedTarget = {
  localDate: "2035-08-13",
  serviceId: "manicure",
  variantId: "manicure-30-min",
};
const suiteSource = readFileSync(
  new URL("../../scripts/booking-concurrency-suite.mjs", import.meta.url),
  "utf8",
);

function bookingReconciliation(overrides = {}) {
  return {
    appointments: 1,
    outbox_rows: 2,
    command_rows: 20,
    completed_commands: 1,
    failed_commands: 19,
    domain_changes: 1,
    ...overrides,
  };
}

function bookingResults() {
  return [
    { http_status: 201, code: "BOOKING_CREATED", replayed: false },
    ...Array.from({ length: 19 }, () => ({
      http_status: 409,
      code: "SLOT_UNAVAILABLE",
      replayed: false,
    })),
  ];
}

describe("booking concurrency target and safety", () => {
  it("builds five bounded dates and one validated catalog target", () => {
    const rows = Array.from({ length: 5 }, (_, index) => ({
      ...target,
      scenario_index: index + 1,
      local_date: `2035-08-${String(13 + index).padStart(2, "0")}`,
    }));
    expect(parseRaceTargets(rows)).toHaveLength(5);
    expect(raceTargetQuery).toContain("generate_series(1, 14)");
    expect(raceTargetQuery).toContain("limit 5");
    expect(raceTargetQuery).not.toContain("gioia_private.rome_today");
    expect(RUNTIME_ROLE_SQL).toBe("set local role app_runtime");
    expect(COORDINATOR_BARRIER_SQL).toContain("pg_try_advisory_xact_lock(");
    expect(WORKER_BARRIER_SQL).toContain("pg_advisory_xact_lock_shared(");
    expect(BARRIER_WAITERS_SQL).toContain("not granted");
    expect(DATABASE_POOL_SIZE).toBe(21);
    expect(parseBarrierWaiterCount({ waiting: "20" }, 20)).toBe(20);
    expect(parseBarrierWaiterCount({ waiting: "20" }, 5, 20)).toBe(20);
    expect(() => parseBarrierWaiterCount({ waiting: 21 }, 20)).toThrow(
      "invalid waiter count",
    );
    expect(() => parseBarrierWaiterCount({ waiting: 6 }, 5, 5)).toThrow(
      "invalid waiter count",
    );
  });

  it("rejects malformed target identifiers, indices, and duplicates", () => {
    expect(() =>
      parseRaceTarget({ ...target, service_id: "unsafe'; select" }),
    ).toThrow("invalid identifiers");
    expect(() => parseRaceTargets([])).toThrow("five dates");
    const duplicateRows = Array.from({ length: 5 }, (_, index) => ({
      ...target,
      scenario_index: index + 1,
    }));
    expect(() => parseRaceTargets(duplicateRows)).toThrow("must be distinct");
  });

  it("can leave privileged owner provisioning to the TEST operator", async () => {
    const ownerUnsafe = vi.fn(async () => {
      throw new Error("owner fixture must not run");
    });
    const raceFailure = new Error("synthetic race boundary");
    const sql = {
      begin: vi.fn(async () => {
        throw raceFailure;
      }),
      unsafe: ownerUnsafe,
    };
    const targets = Array.from({ length: 5 }, (_, index) => ({
      ...parsedTarget,
      localDate: `2035-08-${String(13 + index).padStart(2, "0")}`,
    }));

    await expect(
      runBookingConcurrencySuite(sql, {
        reconciliationSql: sql,
        targets,
        provisionOwner: false,
      }),
    ).rejects.toBe(raceFailure);
    expect(ownerUnsafe).not.toHaveBeenCalled();
  });

  it("requires an explicit query-capable reconciliation database", async () => {
    await expect(
      runBookingConcurrencySuite(
        { begin: vi.fn(), unsafe: vi.fn() },
        { reconciliationSql: {}, targets: [], provisionOwner: false },
      ),
    ).rejects.toThrow("reconciliation database is invalid");
  });

  it("routes all four direct-table reconciliations away from runtime SQL", () => {
    expect(suiteSource.match(/queryOne\(\s*reconciliationSql,/g)).toHaveLength(
      4,
    );
    expect(suiteSource).not.toMatch(/queryOne\(\s*sql,/);
  });

  it("accepts only the loopback local postgres URL", () => {
    const localUrl = "postgresql://postgres:postgres@127.0.0.1:54322/postgres";
    expect(parseLocalDatabaseUrl(localUrl)).toBe(localUrl);
    const alternateLocalUrl =
      "postgresql://postgres:postgres@127.0.0.1:56322/postgres";
    expect(parseLocalDatabaseUrl(alternateLocalUrl, "56322")).toBe(
      alternateLocalUrl,
    );
    expect(() =>
      parseLocalDatabaseUrl(
        "postgresql://postgres:secret@db.example.test:5432/postgres",
      ),
    ).toThrow("safe local database URL");
    expect(() =>
      parseLocalDatabaseUrl(
        "postgresql://app_runtime:secret@127.0.0.1:54322/postgres",
      ),
    ).toThrow("safe local database URL");
    expect(() =>
      parseLocalDatabaseUrl(
        "postgresql://postgres:secret@127.0.0.1:6543/postgres",
      ),
    ).toThrow("safe local database URL");
    expect(() =>
      parseLocalDatabaseUrl(
        "postgresql://postgres:secret@127.0.0.1:54322/postgres?sslmode=require",
      ),
    ).toThrow("safe local database URL");
  });

  it("builds restricted commands and rejects injected reconciliation IDs", () => {
    expect(bookingQuery(1, parsedTarget)).not.toContain("set role");
    expect(identicalBookingQuery(parsedTarget)).toContain("race-identical-key");
    expect(bookingVacationBookingQuery(parsedTarget)).toContain(
      "race-booking-vacation-book",
    );
    expect(bookingVacationVacationQuery(parsedTarget)).toContain(
      "owner_create_vacation",
    );
    const ownerQueries = [
      bookingVacationVacationQuery(parsedTarget),
      ownerCreateAppointmentQuery(parsedTarget, "a", "41"),
      ownerRescheduleQuery({
        entryId: "d1000000-0000-4000-8000-000000000001",
        target: parsedTarget,
        suffix: "a",
        fingerprintByte: "43",
      }),
    ];
    expect(
      ownerQueries.every((query) => query.includes("request.jwt.claim.sub")),
    ).toBe(true);
    expect(
      ownerQueries.every((query) =>
        query.includes("request.jwt.claim.session_id"),
      ),
    ).toBe(true);
    expect(() =>
      ownerRescheduleQuery({
        entryId: "unsafe'; select",
        target: parsedTarget,
        suffix: "a",
        fingerprintByte: "43",
      }),
    ).toThrow("Invalid opposite-reschedule");
    expect(() =>
      oppositeRescheduleReconciliationQuery({
        entryA: "unsafe",
        entryB: "b",
        dateA: "2035-08-13",
        dateB: "2035-08-14",
      }),
    ).toThrow("Invalid opposite-reschedule");
  });
});

describe("distinct and identical booking races", () => {
  it("accepts exactly one distinct-key winner and nineteen conflicts", () => {
    expect(
      assertConcurrencyResults(bookingResults(), bookingReconciliation()),
    ).toEqual({
      accepted: 1,
      conflicts: 19,
      appointments: 1,
      outbox: 2,
      commands: 20,
      changes: 1,
    });
  });

  it("rejects distinct-key winner or persistence drift", () => {
    const twoWinners = bookingResults();
    twoWinners[1] = {
      http_status: 201,
      code: "BOOKING_CREATED",
      replayed: false,
    };
    expect(() =>
      assertConcurrencyResults(twoWinners, bookingReconciliation()),
    ).toThrow("Exactly one booking");
    expect(() =>
      assertConcurrencyResults(
        bookingResults(),
        bookingReconciliation({ domain_changes: 2 }),
      ),
    ).toThrow("reconciliation failed");
  });

  it("converges identical calls to one execution and nineteen replays", () => {
    const results = [
      { http_status: 201, code: "BOOKING_CREATED", replayed: false },
      ...Array.from({ length: 19 }, () => ({
        http_status: 201,
        code: "BOOKING_CREATED",
        replayed: true,
      })),
    ];
    expect(
      assertIdenticalKeyReplayRace(
        results,
        bookingReconciliation({
          command_rows: 1,
          failed_commands: 0,
        }),
      ),
    ).toMatchObject({ firstExecutions: 1, replays: 19, commands: 1 });
    expect(() =>
      assertIdenticalKeyReplayRace(
        results.map((row) => ({ ...row, replayed: true })),
        bookingReconciliation({ command_rows: 1, failed_commands: 0 }),
      ),
    ).toThrow("must converge");
  });
});

describe("cross-operation schedule races", () => {
  it.each([
    [
      "booking",
      [
        { http_status: 201, code: "BOOKING_CREATED", replayed: false },
        {
          http_status: 409,
          code: "VACATION_CONFLICTS_WITH_SCHEDULE",
          replayed: false,
        },
      ],
      { appointments: 1, vacations: 0, outbox_rows: 2 },
    ],
    [
      "vacation",
      [
        {
          http_status: 409,
          code: "DATE_CLOSED_FOR_VACATION",
          replayed: false,
        },
        { http_status: 201, code: "VACATION_CREATED", replayed: false },
      ],
      { appointments: 0, vacations: 1, outbox_rows: 0 },
    ],
  ])("reconciles a %s winner", (winner, results, actionCounts) => {
    expect(
      assertBookingVacationRace(results, {
        ...actionCounts,
        command_rows: 2,
        completed_commands: 1,
        failed_commands: 1,
        domain_changes: 1,
      }),
    ).toMatchObject({ winner, changes: 1 });
  });

  it("rejects a booking-vacation double win", () => {
    expect(() =>
      assertBookingVacationRace(
        [
          { http_status: 201, code: "BOOKING_CREATED", replayed: false },
          { http_status: 201, code: "VACATION_CREATED", replayed: false },
        ],
        {},
      ),
    ).toThrow("one winner");
  });

  it("keeps opposite-direction reschedule originals unchanged", () => {
    const conflicts = Array.from({ length: 2 }, () => ({
      http_status: 409,
      code: "SLOT_UNAVAILABLE",
      replayed: false,
    }));
    const reconciliation = {
      entries: 2,
      original_positions: 2,
      original_versions: 2,
      overlaps: 0,
      command_rows: 2,
      failed_commands: 2,
      reschedule_changes: 0,
      reschedule_outbox: 0,
    };
    expect(assertOppositeRescheduleRace(conflicts, reconciliation)).toEqual({
      entries: 2,
      originalPositions: 2,
      failed: 2,
    });
    expect(() =>
      assertOppositeRescheduleRace(conflicts, {
        ...reconciliation,
        original_positions: 0,
      }),
    ).toThrow("reconciliation failed");
  });

  it("accepts only a successful owner fixture resource ID", () => {
    const id = "d1000000-0000-4000-8000-000000000001";
    expect(
      parseCreatedAppointment({
        http_status: 201,
        code: "APPOINTMENT_CREATED",
        resource_id: id,
        replayed: false,
      }),
    ).toBe(id);
    expect(() => parseCreatedAppointment({ resource_id: id })).toThrow(
      "fixture creation failed",
    );
  });
});

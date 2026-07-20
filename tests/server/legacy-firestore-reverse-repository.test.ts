import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { compileLegacyFirestoreReversePlan } from "@/lib/server/migration/legacyFirestoreReverse.ts";
import { extractLegacyFirestoreReverseInput } from "@/lib/server/migration/legacyFirestoreReverseRepository.ts";
import {
  reverseChange as change,
  reverseInstant as instant,
  reverseRepositoryDatabase as database,
  reverseSchedule as schedule,
  reverseScheduleId as scheduleId,
  reverseSubscriber as subscriber,
  reverseSubscriberId as subscriberId,
  reverseVacationId as vacationId,
} from "@/tests/server/migration/fixtures/legacyFirestoreReverseRepositoryFixtures.ts";

describe("legacy Firestore reverse extractor repository", () => {
  it("captures one bounded compiler-ready repeatable-read snapshot", async () => {
    const fixture = database();
    const input = await extractLegacyFirestoreReverseInput(fixture.target, {
      afterSequence: 0,
      limit: 500,
    });

    expect(input).toMatchObject({
      afterSequence: 0,
      sourceHighWaterSequence: 3,
      sourceExhausted: true,
      limit: 500,
    });
    expect(input.changes).toHaveLength(3);
    expect(input.scheduleEntries[0]).toMatchObject({
      id: scheduleId,
      localDate: "2026-08-10",
      createdAt: instant,
    });
    expect(compileLegacyFirestoreReversePlan(input)).toMatchObject({
      throughSequence: 3,
      complete: true,
      counts: { sourceChanges: 3, operations: 3 },
    });
    expect(fixture.queries[0]?.sql).toContain(
      "set transaction isolation level repeatable read, read only",
    );
    expect(fixture.queries[4]?.sql).toContain("set local role gioia_mutator");
    expect(fixture.queries[5]?.sql).toContain("max(sequence_id)");
    expect(fixture.queries[6]).toMatchObject({ parameters: [0, 3] });
    expect(fixture.queries[6]?.sql).toContain("limit 10001");
    expect(
      fixture.queries.slice(7).map((query) => query.parameters?.[0]),
    ).toEqual([[scheduleId], [vacationId], [subscriberId]]);
  });

  it("derives non-exhaustion from the captured high-water", async () => {
    const fixture = database({
      highWater: 4,
      changes: [change(1, "schedule_entry", scheduleId)],
      vacations: [],
      subscribers: [],
    });
    const input = await extractLegacyFirestoreReverseInput(fixture.target, {
      afterSequence: 0,
      limit: 1,
    });
    expect(input.sourceExhausted).toBe(false);
    expect(compileLegacyFirestoreReversePlan(input).complete).toBe(false);
  });

  it("accepts an empty snapshot exactly at the source high-water", async () => {
    const fixture = database({
      highWater: 7,
      changes: [],
      schedules: [],
      vacations: [],
      subscribers: [],
    });
    const input = await extractLegacyFirestoreReverseInput(fixture.target, {
      afterSequence: 7,
      limit: 10,
    });
    expect(input).toMatchObject({ sourceExhausted: true, changes: [] });
  });

  it("accepts legitimate PostgreSQL sequence gaps", async () => {
    const fixture = database({
      highWater: 5,
      changes: [
        change(2, "schedule_entry", scheduleId),
        change(5, "vacation", vacationId),
      ],
      subscribers: [],
    });
    const input = await extractLegacyFirestoreReverseInput(fixture.target, {
      afterSequence: 0,
      limit: 10,
    });
    expect(input).toMatchObject({ sourceExhausted: true });
    expect(input.changes.map((item) => item.sequenceId)).toEqual([2, 5]);
  });

  it("accepts a complete 10,000-change window and fails on lookahead", async () => {
    const ids = Array.from(
      { length: 10_001 },
      (_, index) =>
        `10000000-0000-4000-8000-${String(index + 1).padStart(12, "0")}`,
    );
    const changes = ids.map((id, index) =>
      change(index + 1, "subscriber", id, 1, "subscribe"),
    );
    const subscribers = ids.slice(0, 10_000).map((id, index) => ({
      ...subscriber(),
      id,
      legacy_firestore_id: `legacy-${index + 1}`,
      email: `subscriber-${index + 1}@example.test`,
    }));
    const complete = database({
      highWater: 10_000,
      changes: changes.slice(0, 10_000),
      schedules: [],
      vacations: [],
      subscribers,
    });
    const input = await extractLegacyFirestoreReverseInput(complete.target, {
      afterSequence: 0,
      limit: 500,
    });
    expect(input.changes).toHaveLength(10_000);
    expect(input.subscribers).toHaveLength(10_000);
    expect(input.sourceExhausted).toBe(true);
    expect(input.changes.at(-1)?.sequenceId).toBe(10_000);

    const overflow = database({
      highWater: 10_001,
      changes,
      schedules: [],
      vacations: [],
      subscribers,
    });
    await expect(
      extractLegacyFirestoreReverseInput(overflow.target, {
        afterSequence: 0,
        limit: 500,
      }),
    ).rejects.toThrow("REVERSE_CHANGE_WINDOW_EXCEEDED");
  });

  it.each([
    [
      "duplicate aggregate version",
      [
        change(1, "schedule_entry", scheduleId),
        change(2, "schedule_entry", scheduleId),
      ],
      "REVERSE_CHANGE_DUPLICATE",
    ],
    [
      "out-of-order sequence",
      [
        change(2, "vacation", vacationId),
        change(1, "schedule_entry", scheduleId),
      ],
      "REVERSE_SEQUENCE_WINDOW_DISCONTINUOUS",
    ],
    [
      "unsupported aggregate",
      [change(1, "unsupported", scheduleId)],
      "REVERSE_AGGREGATE_KIND_UNSUPPORTED",
    ],
    [
      "unsupported change",
      [change(1, "schedule_entry", scheduleId, 1, "remove")],
      "REVERSE_CHANGE_KIND_UNSUPPORTED",
    ],
    [
      "aggregate version jump",
      [
        change(1, "schedule_entry", scheduleId),
        change(2, "schedule_entry", scheduleId, 3, "update"),
      ],
      "REVERSE_AGGREGATE_VERSION_DISCONTINUOUS",
    ],
  ])("rejects a %s", async (_label, changes, error) => {
    const fixture = database({ highWater: changes.length, changes });
    await expect(
      extractLegacyFirestoreReverseInput(fixture.target, {
        afterSequence: 0,
        limit: 10,
      }),
    ).rejects.toThrow(error);
  });

  it("rejects missing, extra, and stale canonical aggregate snapshots", async () => {
    await expect(
      extractLegacyFirestoreReverseInput(database({ schedules: [] }).target, {
        afterSequence: 0,
        limit: 10,
      }),
    ).rejects.toThrow("REVERSE_TARGET_ROW_MISSING");
    await expect(
      extractLegacyFirestoreReverseInput(
        database({ schedules: [schedule(2)] }).target,
        { afterSequence: 0, limit: 10 },
      ),
    ).rejects.toThrow("REVERSE_TARGET_VERSION_MISMATCH");
    await expect(
      extractLegacyFirestoreReverseInput(
        database({
          schedules: [schedule(), { ...schedule(), id: subscriberId }],
        }).target,
        { afterSequence: 0, limit: 10 },
      ),
    ).rejects.toThrow("REVERSE_TARGET_ROW_EXTRA");
  });

  it("rejects cursors beyond the captured source and invalid bounds", async () => {
    await expect(
      extractLegacyFirestoreReverseInput(database().target, {
        afterSequence: 4,
        limit: 10,
      }),
    ).rejects.toThrow("REVERSE_CURSOR_EXCEEDS_HIGH_WATER");
    await expect(
      extractLegacyFirestoreReverseInput(database().target, {
        afterSequence: 0,
        limit: 501,
      }),
    ).rejects.toThrow();
  });
});

import { describe, expect, it } from "vitest";

import {
  assertLocalPostgresRecoveryMatch,
  parseLocalPostgresRecoveryEvidence,
  parseLocalPostgresRecoveryPsql,
} from "../../scripts/local-postgres-recovery-evidence.mjs";

function evidence() {
  const tables = Object.fromEntries(
    [
      "migration_runs",
      "migration_records",
      "migration_quarantine",
      "schedule_entries",
      "vacations",
      "newsletter_subscribers",
      "domain_change_log",
      "command_requests",
      "email_outbox",
      "cutover_write_control",
      "cutover_transition_log",
    ].map((name, index) => [name, { count: index, sha256: "ab".repeat(32) }]),
  );
  return {
    tables,
    migrations: { count: 60, sha256: "cd".repeat(32) },
    sequences: Object.fromEntries(
      [
        "migration_quarantine_id_seq",
        "domain_change_log_sequence_id_seq",
        "newsletter_consent_events_sequence_id_seq",
        "email_dead_letter_events_sequence_id_seq",
        "cutover_transition_log_sequence_id_seq",
        "cutover_canary_events_sequence_id_seq",
      ].map((name, index) => [
        name,
        { lastValue: index + 1, isCalled: index % 2 === 0 },
      ]),
    ),
    activeScheduleOverlaps: 0,
    activeVacationOverlaps: 0,
    cutoverMode: "frozen",
  };
}

describe("Local PostgreSQL recovery evidence", () => {
  it("accepts exact frozen, overlap-free evidence from psql", () => {
    const value = evidence();
    expect(
      parseLocalPostgresRecoveryPsql(`${JSON.stringify(value)}\n`),
    ).toEqual(value);
    expect(
      assertLocalPostgresRecoveryMatch(value, structuredClone(value)),
    ).toBe(true);
  });

  it("rejects open, overlapping, malformed, and mismatched evidence", () => {
    expect(() =>
      parseLocalPostgresRecoveryEvidence({
        ...evidence(),
        cutoverMode: "open",
      }),
    ).toThrow("LOCAL_RECOVERY_INVARIANT_FAILED");
    expect(() =>
      parseLocalPostgresRecoveryEvidence({
        ...evidence(),
        activeScheduleOverlaps: 1,
      }),
    ).toThrow("LOCAL_RECOVERY_INVARIANT_FAILED");
    expect(() => parseLocalPostgresRecoveryPsql("not-json\n")).toThrow(
      "LOCAL_RECOVERY_OUTPUT_INVALID",
    );
    expect(() =>
      parseLocalPostgresRecoveryEvidence({
        ...evidence(),
        sequences: {},
      }),
    ).toThrow("LOCAL_RECOVERY_SEQUENCES_INVALID");
    const changed = evidence();
    changed.tables.schedule_entries = {
      ...changed.tables.schedule_entries,
      count: 1,
    };
    expect(() => assertLocalPostgresRecoveryMatch(evidence(), changed)).toThrow(
      "LOCAL_RECOVERY_MISMATCH",
    );
  });
});

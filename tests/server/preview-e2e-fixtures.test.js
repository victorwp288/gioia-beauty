import { describe, expect, it } from "vitest";

import { assertPreviewBookingCleanupState } from "../../scripts/preview-e2e-fixtures.mjs";
import { assertPreviewMaintenanceEvidence } from "../../scripts/preview-e2e-maintenance-fixture.mjs";

describe("Preview browser residue contract", () => {
  it.each([
    {
      commands: 0,
      completed_commands: 0,
      failed_commands: 0,
      entries: 0,
      exact_entries: 0,
      changes: 0,
      outbox_rows: 0,
    },
    {
      commands: 1,
      completed_commands: 1,
      failed_commands: 0,
      entries: 1,
      exact_entries: 1,
      changes: 1,
      outbox_rows: 2,
    },
    {
      commands: 1,
      completed_commands: 0,
      failed_commands: 1,
      entries: 0,
      exact_entries: 0,
      changes: 0,
      outbox_rows: 0,
    },
  ])("accepts only an empty, completed, or failed exact booking", (row) => {
    expect(() => assertPreviewBookingCleanupState(row)).not.toThrow();
  });

  it.each([
    { exact_entries: 0 },
    { outbox_rows: 1 },
    { changes: 2 },
    { commands: 2 },
    { failed_commands: 1 },
  ])("rejects malformed residue %#", (change) => {
    expect(() =>
      assertPreviewBookingCleanupState({
        commands: 1,
        completed_commands: 1,
        failed_commands: 0,
        entries: 1,
        exact_entries: 1,
        changes: 1,
        outbox_rows: 2,
        ...change,
      }),
    ).toThrow("booking residue is not exact");
  });
});

describe("Preview maintenance evidence contract", () => {
  const exact = Object.freeze({
    run_exact: true,
    ledger_exact: true,
    runs: 1,
    grants: 2,
    used_grants: 2,
    events: 2,
    commands: 4,
    completed_commands: 4,
    blocked_commands: 0,
    entries: 2,
    exact_entries: 2,
    active_entries: 0,
    changes: 4,
    outbox_rows: 0,
  });

  it("accepts only the complete hosted rehearsal evidence", () => {
    expect(() => assertPreviewMaintenanceEvidence(exact)).not.toThrow();
  });

  it.each([
    { run_exact: false },
    { ledger_exact: false },
    { used_grants: 1 },
    { events: 3 },
    { blocked_commands: 1 },
    { exact_entries: 1 },
    { active_entries: 1 },
    { changes: 3 },
    { outbox_rows: 1 },
  ])("rejects incomplete or foreign evidence %#", (change) => {
    expect(() =>
      assertPreviewMaintenanceEvidence({ ...exact, ...change }),
    ).toThrow("maintenance evidence is not exact");
  });
});

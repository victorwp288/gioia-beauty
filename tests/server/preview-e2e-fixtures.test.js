import { describe, expect, it } from "vitest";

import { assertPreviewBookingCleanupState } from "../../scripts/preview-e2e-fixtures.mjs";

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

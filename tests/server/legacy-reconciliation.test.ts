import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import {
  LegacyReconciliationInputError,
  reconcileLegacyMigration,
  type LegacyReconciliationInput,
  type LegacySemanticSnapshot,
} from "@/lib/server/migration/legacyReconciliation.ts";

const hash = (character: string) => character.repeat(64);
const appointment = (overrides: Partial<LegacySemanticSnapshot> = {}) => ({
  entityKind: "appointment" as const,
  status: "confirmed" as const,
  futureConfirmed: true,
  dateTimeSha256: hash("a"),
  durationBufferSha256: hash("b"),
  ...overrides,
});
const block = (): LegacySemanticSnapshot => ({
  entityKind: "block",
  status: "active",
  futureConfirmed: false,
  dateTimeSha256: hash("c"),
  durationBufferSha256: hash("d"),
});

function validInput(): LegacyReconciliationInput {
  return {
    maxRecords: 20,
    source: [
      {
        sourceCollection: "customers",
        sourceId: "legacy-appointment",
        sourceRecordSha256: hash("1"),
        entityKind: "appointment",
        sourceStatus: "confirmed",
        expected: appointment(),
      },
      {
        sourceCollection: "customers",
        sourceId: "legacy-block",
        sourceRecordSha256: hash("2"),
        entityKind: "block",
        sourceStatus: "confirmed",
        expected: block(),
      },
      {
        sourceCollection: "newsletter_subscribers",
        sourceId: "ambiguous-subscriber",
        sourceRecordSha256: hash("3"),
        entityKind: "subscriber",
        sourceStatus: "missing",
        expected: null,
      },
    ],
    transformed: [
      {
        sourceCollection: "customers",
        sourceId: "legacy-appointment",
        sourceRecordSha256: hash("1"),
        targetRecordSha256: hash("4"),
        semantic: appointment(),
      },
      {
        sourceCollection: "customers",
        sourceId: "legacy-block",
        sourceRecordSha256: hash("2"),
        targetRecordSha256: hash("5"),
        semantic: block(),
      },
    ],
    imported: [
      {
        sourceCollection: "customers",
        sourceId: "legacy-appointment",
        sourceRecordSha256: hash("1"),
        targetId: "target-appointment",
        targetRecordSha256: hash("4"),
        semantic: appointment(),
      },
      {
        sourceCollection: "customers",
        sourceId: "legacy-block",
        sourceRecordSha256: hash("2"),
        targetId: "target-block",
        targetRecordSha256: hash("5"),
        semantic: block(),
      },
    ],
    quarantine: [
      {
        sourceCollection: "newsletter_subscribers",
        sourceId: "ambiguous-subscriber",
        sourceRecordSha256: hash("3"),
        reasonCode: "DUPLICATE_NORMALIZED_EMAIL",
        fieldCodes: ["EMAIL"],
        reviewed: true,
      },
    ],
    duplicates: [
      {
        scope: "source",
        kind: "normalized_subscriber_email",
        groupSha256: hash("6"),
        recordCount: 2,
        reviewed: true,
      },
    ],
  };
}

describe("legacy migration reconciliation", () => {
  it("proves the exact source partition and emits only redacted aggregates", () => {
    const report = reconcileLegacyMigration(validInput());

    expect(report).toMatchObject({
      contractVersion: 1,
      ok: true,
      counts: {
        source: 3,
        transformed: 2,
        imported: 2,
        quarantined: 1,
        reviewedQuarantine: 1,
        sourceFutureConfirmed: 1,
        importedFutureConfirmed: 1,
        reviewedSourceDuplicateGroups: 1,
        byCollection: { customers: 2, newsletter_subscribers: 1 },
        byEntity: { appointment: 1, block: 1, subscriber: 1 },
        byStatus: { confirmed: 2, missing: 1 },
        byQuarantineReason: { DUPLICATE_NORMALIZED_EMAIL: 1 },
      },
      stopConditions: [],
    });
    expect(report.reportSha256).toMatch(/^[a-f0-9]{64}$/);
    expect(JSON.stringify(report)).not.toContain("legacy-appointment");
    expect(JSON.stringify(report)).not.toContain("ambiguous-subscriber");
    expect(JSON.stringify(report)).not.toContain("target-appointment");
    expect(Object.isFrozen(report)).toBe(true);
    expect(Object.isFrozen(report.counts)).toBe(true);
  });

  it("reconciles imported vacation and subscriber semantics", () => {
    const vacation: LegacySemanticSnapshot = {
      entityKind: "vacation",
      status: "active",
      futureConfirmed: false,
      dateTimeSha256: hash("7"),
      durationBufferSha256: hash("8"),
    };
    const subscriber: LegacySemanticSnapshot = {
      entityKind: "subscriber",
      status: "legacy_unverified",
      futureConfirmed: false,
      dateTimeSha256: hash("9"),
      durationBufferSha256: hash("0"),
    };
    const source = [
      {
        sourceCollection: "vacations" as const,
        sourceId: "vacation-id",
        sourceRecordSha256: hash("1"),
        entityKind: "vacation" as const,
        sourceStatus: "missing" as const,
        expected: vacation,
      },
      {
        sourceCollection: "newsletter_subscribers" as const,
        sourceId: "subscriber-id",
        sourceRecordSha256: hash("2"),
        entityKind: "subscriber" as const,
        sourceStatus: "active" as const,
        expected: subscriber,
      },
    ];
    const transformed = source.map((record, index) => ({
      sourceCollection: record.sourceCollection,
      sourceId: record.sourceId,
      sourceRecordSha256: record.sourceRecordSha256,
      targetRecordSha256: hash(index === 0 ? "3" : "4"),
      semantic: record.expected,
    }));
    const report = reconcileLegacyMigration({
      maxRecords: 10,
      source,
      transformed,
      imported: transformed.map((record, index) => ({
        ...record,
        targetId: `target-${index}`,
      })),
      quarantine: [],
    });

    expect(report.ok).toBe(true);
    expect(report.counts.byEntity).toEqual({ subscriber: 1, vacation: 1 });
    expect(report.counts.byStatus).toEqual({ active: 1, missing: 1 });
  });

  it("fails closed on missing, double, orphan, and incomplete dispositions", () => {
    const base = validInput();
    const report = reconcileLegacyMigration({
      ...base,
      transformed: [
        ...base.transformed,
        {
          sourceCollection: "vacations",
          sourceId: "orphan",
          sourceRecordSha256: hash("7"),
          targetRecordSha256: hash("7"),
          semantic: {
            ...block(),
            entityKind: "vacation",
          },
        },
      ],
      imported: base.imported.slice(0, 1),
      quarantine: [
        ...base.quarantine,
        {
          sourceCollection: "customers",
          sourceId: "legacy-appointment",
          sourceRecordSha256: hash("1"),
          reasonCode: "MANUAL_REVIEW",
          fieldCodes: [],
          reviewed: true,
        },
      ],
    });

    expect(report.ok).toBe(false);
    expect(report.stopConditions).toEqual(
      expect.arrayContaining([
        { code: "ORPHAN_DISPOSITION", count: 1 },
        { code: "SOURCE_DISPOSITION_MISMATCH", count: 2 },
      ]),
    );
  });

  it("detects status, date-time, duration-buffer, checksum and future mismatches", () => {
    const base = validInput();
    const changed = appointment({
      status: "completed",
      futureConfirmed: false,
      dateTimeSha256: hash("8"),
      durationBufferSha256: hash("9"),
    });
    const report = reconcileLegacyMigration({
      ...base,
      imported: base.imported.map((record, index) =>
        index === 0
          ? { ...record, targetRecordSha256: hash("0"), semantic: changed }
          : record,
      ),
    });

    expect(report.ok).toBe(false);
    expect(report.stopConditions).toEqual(
      expect.arrayContaining([
        { code: "STATUS_MISMATCH", count: 1 },
        { code: "FUTURE_CONFIRMED_MISMATCH", count: 1 },
        { code: "FUTURE_CONFIRMED_COUNT_MISMATCH", count: 1 },
        { code: "DATE_TIME_MISMATCH", count: 1 },
        { code: "DURATION_BUFFER_MISMATCH", count: 1 },
        { code: "TARGET_CHECKSUM_MISMATCH", count: 1 },
      ]),
    );
  });

  it("binds every disposition to the exact current source record bytes", () => {
    const base = validInput();
    const report = reconcileLegacyMigration({
      ...base,
      transformed: base.transformed.map((record, index) =>
        index === 0 ? { ...record, sourceRecordSha256: hash("7") } : record,
      ),
      imported: base.imported.map((record, index) =>
        index === 1 ? { ...record, sourceRecordSha256: hash("8") } : record,
      ),
      quarantine: base.quarantine.map((record) => ({
        ...record,
        sourceRecordSha256: hash("9"),
      })),
    });

    expect(report.ok).toBe(false);
    expect(report.stopConditions).toEqual(
      expect.arrayContaining([
        { code: "TRANSFORM_SOURCE_CHECKSUM_MISMATCH", count: 1 },
        { code: "IMPORT_SOURCE_CHECKSUM_MISMATCH", count: 1 },
        { code: "QUARANTINE_SOURCE_CHECKSUM_MISMATCH", count: 1 },
      ]),
    );
  });

  it("stops for unreviewed quarantine and any target duplicate or overlap", () => {
    const base = validInput();
    const report = reconcileLegacyMigration({
      ...base,
      quarantine: base.quarantine.map((record) => ({
        ...record,
        reviewed: false,
      })),
      duplicates: [
        {
          scope: "source",
          kind: "active_schedule_overlap",
          groupSha256: hash("a"),
          recordCount: 2,
          reviewed: false,
        },
        {
          scope: "target",
          kind: "active_vacation_overlap",
          groupSha256: hash("b"),
          recordCount: 2,
          reviewed: true,
        },
      ],
    });

    expect(report.stopConditions).toEqual(
      expect.arrayContaining([
        { code: "UNREVIEWED_QUARANTINE", count: 1 },
        { code: "UNRESOLVED_SOURCE_DUPLICATE", count: 1 },
        { code: "TARGET_DUPLICATE", count: 1 },
      ]),
    );
  });

  it("is deterministic regardless of input order", () => {
    const input = validInput();
    const first = reconcileLegacyMigration(input);
    const second = reconcileLegacyMigration({
      ...input,
      source: [...input.source].reverse(),
      transformed: [...input.transformed].reverse(),
      imported: [...input.imported].reverse(),
    });

    expect(second.checksums).toEqual(first.checksums);
    expect(second.reportSha256).toBe(first.reportSha256);
  });

  it.each([
    ["bound", { ...validInput(), maxRecords: 0 }, "INVALID_BOUND"],
    [
      "duplicate source",
      {
        ...validInput(),
        source: [validInput().source[0]!, validInput().source[0]!],
      },
      "DUPLICATE_SOURCE_ID",
    ],
    [
      "unsafe reason",
      {
        ...validInput(),
        quarantine: [
          { ...validInput().quarantine[0]!, reasonCode: "private value" },
        ],
      },
      "INVALID_CODE",
    ],
  ])("rejects invalid %s with a fixed non-PII error", (_name, input, code) => {
    let caught: unknown;
    try {
      reconcileLegacyMigration(input as LegacyReconciliationInput);
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeInstanceOf(LegacyReconciliationInputError);
    expect(caught).toMatchObject({ code });
    expect((caught as Error).message).toBe(
      "Legacy reconciliation input is invalid",
    );
  });
});

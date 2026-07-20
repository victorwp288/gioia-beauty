import "server-only";

export const LEGACY_RECONCILIATION_MAX_RECORDS = 100_000;

const SHA256 = /^[a-f0-9]{64}$/;
const SAFE_CODE = /^[A-Z][A-Z0-9_]{1,63}$/;
const CONTROL_CHARACTER = /[\u0000-\u001f\u007f]/;
export const COLLECTIONS = [
  "customers",
  "vacations",
  "newsletter_subscribers",
  "settings",
  "analytics",
] as const;
export const ENTITIES = [
  "appointment",
  "block",
  "vacation",
  "subscriber",
  "unknown",
] as const;
export const STATUSES = [
  "confirmed",
  "completed",
  "cancelled",
  "no_show",
  "active",
  "legacy_unverified",
  "pending",
  "unsubscribed",
  "bounced",
  "complained",
  "missing",
  "unknown",
] as const;
export const DUPLICATE_KINDS = [
  "normalized_subscriber_email",
  "active_schedule_overlap",
  "active_vacation_overlap",
] as const;

export type LegacySourceCollection = (typeof COLLECTIONS)[number];
export type LegacyEntityKind = (typeof ENTITIES)[number];
export type LegacyStatus = (typeof STATUSES)[number];
export type LegacyDuplicateKind = (typeof DUPLICATE_KINDS)[number];

export interface LegacySemanticSnapshot {
  readonly entityKind: Exclude<LegacyEntityKind, "unknown">;
  readonly status: Exclude<LegacyStatus, "missing" | "unknown">;
  readonly futureConfirmed: boolean;
  readonly dateTimeSha256: string;
  readonly durationBufferSha256: string;
}

export interface LegacySourceLedgerRecord {
  readonly sourceCollection: LegacySourceCollection;
  readonly sourceId: string;
  readonly sourceRecordSha256: string;
  readonly entityKind: LegacyEntityKind;
  readonly sourceStatus: LegacyStatus;
  readonly expected: LegacySemanticSnapshot | null;
}

export interface LegacyTransformedRecord {
  readonly sourceCollection: LegacySourceCollection;
  readonly sourceId: string;
  readonly sourceRecordSha256: string;
  readonly targetRecordSha256: string;
  readonly semantic: LegacySemanticSnapshot;
}

export interface LegacyImportedRecord extends LegacyTransformedRecord {
  readonly targetId: string;
}

export interface LegacyQuarantineRecord {
  readonly sourceCollection: LegacySourceCollection;
  readonly sourceId: string;
  readonly sourceRecordSha256: string;
  readonly reasonCode: string;
  readonly fieldCodes: readonly string[];
  readonly reviewed: boolean;
}

export interface LegacyDuplicateFinding {
  readonly scope: "source" | "target";
  readonly kind: LegacyDuplicateKind;
  readonly groupSha256: string;
  readonly recordCount: number;
  readonly reviewed: boolean;
}

export interface LegacyReconciliationInput {
  readonly maxRecords: number;
  readonly source: readonly LegacySourceLedgerRecord[];
  readonly transformed: readonly LegacyTransformedRecord[];
  readonly imported: readonly LegacyImportedRecord[];
  readonly quarantine: readonly LegacyQuarantineRecord[];
  readonly duplicates?: readonly LegacyDuplicateFinding[];
}

export class LegacyReconciliationInputError extends Error {
  readonly code: string;

  constructor(code: string) {
    super("Legacy reconciliation input is invalid");
    this.name = "LegacyReconciliationInputError";
    this.code = code;
  }
}

export const fail = (code: string): never => {
  throw new LegacyReconciliationInputError(code);
};
export const isSha256 = (value: string) => SHA256.test(value);
export const isSafeId = (value: unknown) =>
  typeof value === "string" &&
  Buffer.byteLength(value, "utf8") >= 1 &&
  Buffer.byteLength(value, "utf8") <= 1500 &&
  !CONTROL_CHARACTER.test(value);

export function assertCode(value: unknown) {
  if (typeof value !== "string" || !SAFE_CODE.test(value)) fail("INVALID_CODE");
}

export function assertSourceIdentity(record: {
  sourceCollection: unknown;
  sourceId: unknown;
}) {
  if (!COLLECTIONS.includes(record.sourceCollection as LegacySourceCollection))
    fail("INVALID_COLLECTION");
  if (!isSafeId(record.sourceId)) fail("INVALID_SOURCE_ID");
}

export function assertSemantic(value: LegacySemanticSnapshot) {
  if (!ENTITIES.slice(0, 4).includes(value.entityKind)) fail("INVALID_ENTITY");
  if (!STATUSES.slice(0, 10).includes(value.status)) fail("INVALID_STATUS");
  if (typeof value.futureConfirmed !== "boolean") fail("INVALID_FUTURE_FLAG");
  if (!isSha256(value.dateTimeSha256) || !isSha256(value.durationBufferSha256))
    fail("INVALID_SEMANTIC_HASH");
  const allowed: Record<
    Exclude<LegacyEntityKind, "unknown">,
    readonly string[]
  > = {
    appointment: ["confirmed", "completed", "cancelled", "no_show"],
    block: ["active", "cancelled"],
    vacation: ["active", "cancelled"],
    subscriber: [
      "legacy_unverified",
      "pending",
      "active",
      "unsubscribed",
      "bounced",
      "complained",
    ],
  };
  if (!allowed[value.entityKind].includes(value.status))
    fail("STATUS_KIND_MISMATCH");
  if (
    value.futureConfirmed &&
    !(value.entityKind === "appointment" && value.status === "confirmed")
  )
    fail("INVALID_FUTURE_FLAG");
}

export function assertInputBounds(input: LegacyReconciliationInput) {
  if (
    !Number.isInteger(input.maxRecords) ||
    input.maxRecords < 1 ||
    input.maxRecords > LEGACY_RECONCILIATION_MAX_RECORDS
  )
    fail("INVALID_BOUND");
  const arrays = [
    input.source,
    input.transformed,
    input.imported,
    input.quarantine,
  ];
  if (
    arrays.some(
      (records) => !Array.isArray(records) || records.length > input.maxRecords,
    )
  )
    fail("BOUND_EXCEEDED");
}

export function assertDuplicateFinding(
  finding: LegacyDuplicateFinding,
  maxRecords: number,
) {
  if (
    !["source", "target"].includes(finding.scope) ||
    !DUPLICATE_KINDS.includes(finding.kind) ||
    !isSha256(finding.groupSha256) ||
    !Number.isInteger(finding.recordCount) ||
    finding.recordCount < 2 ||
    finding.recordCount > maxRecords ||
    typeof finding.reviewed !== "boolean"
  )
    fail("INVALID_DUPLICATE_FINDING");
}

import "server-only";

import { isDeepStrictEqual } from "node:util";

import { z } from "zod";

import { exactDataObject, exactDenseArray } from "../exactData.ts";
import {
  assertPrivacyWorkflowPlan,
  PRIVACY_MAX_TOTAL_ROWS,
  PRIVACY_SUBJECT_STORES,
  type PrivacyWorkflowPlan,
} from "./privacyWorkflow.ts";

export const MAX_PRIVACY_OPERATIONAL_EVIDENCE_BYTES = 4_096;

const PrivacyEvidenceReasonSchema = z.enum([
  "NONE",
  "IDENTITY_NOT_VERIFIED",
  "BOUND_EXCEEDED",
  "UNKNOWN_FIELD",
  "IDENTIFIER_CONFLICT",
  "AMBIGUOUS_SHARED_CONTACT",
  "UNRESOLVED_QUARANTINE",
  "INVALID_HOLD",
  "ACTIVE_HOLD",
  "FUTURE_BOOKING",
  "ACTIVE_DELIVERY",
  "UNPROCESSED_WEBHOOK",
  "PROVIDER_RECONCILIATION_OPEN",
  "RESTORE_REPLAY_GAP",
  "POLICY_NOT_APPROVED",
  "INTERNAL_FAILURE",
]);

const StoreEvidenceSchema = z
  .object({
    store: z.enum(PRIVACY_SUBJECT_STORES),
    readRows: z.number().int().min(0).max(PRIVACY_MAX_TOTAL_ROWS),
    scrubbedFields: z.number().int().min(0).max(PRIVACY_MAX_TOTAL_ROWS),
    deletedRows: z.number().int().min(0).max(PRIVACY_MAX_TOTAL_ROWS),
  })
  .strict();

export interface PrivacyOperationalEvidence {
  readonly v: 1;
  readonly event: "privacy_operation_completed";
  readonly operation: PrivacyWorkflowPlan["operation"];
  readonly environment: PrivacyWorkflowPlan["environment"];
  readonly targetId: PrivacyWorkflowPlan["targetId"];
  readonly startedAt: string;
  readonly completedAt: string;
  readonly status: "completed" | "blocked" | "failed";
  readonly reasonCode: z.infer<typeof PrivacyEvidenceReasonSchema>;
  readonly readRows: number;
  readonly scrubbedFields: number;
  readonly deletedRows: number;
  readonly storesVisited: number;
  readonly artifactDeleted: boolean;
}

const ISO_INSTANT_PATTERN = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;
const issuedEvidence = new WeakSet<object>();

function canonicalInstant(value: unknown): string | null {
  if (typeof value !== "string" || !ISO_INSTANT_PATTERN.test(value))
    return null;
  const milliseconds = Date.parse(value);
  if (!Number.isFinite(milliseconds)) return null;
  return new Date(milliseconds).toISOString() === value ? value : null;
}

function parseStoreEvidence(value: unknown) {
  const source = exactDenseArray(value, 1, PRIVACY_SUBJECT_STORES.length);
  if (!source) return null;
  const stores = source.map((entry) => {
    const snapshot = exactDataObject(entry, [
      "store",
      "readRows",
      "scrubbedFields",
      "deletedRows",
    ]);
    if (!snapshot) return null;
    const candidate = { ...snapshot };
    const parsed = StoreEvidenceSchema.safeParse(candidate);
    return parsed.success && isDeepStrictEqual(candidate, parsed.data)
      ? Object.freeze(parsed.data)
      : null;
  });
  if (stores.some((store) => store === null)) return null;
  const valid = stores as readonly Readonly<
    z.infer<typeof StoreEvidenceSchema>
  >[];
  const positions = valid.map(({ store }) =>
    PRIVACY_SUBJECT_STORES.indexOf(store),
  );
  if (
    new Set(positions).size !== positions.length ||
    positions.some(
      (position, index) => index > 0 && position <= positions[index - 1]!,
    )
  ) {
    return null;
  }
  return Object.freeze(valid);
}

export function createPrivacyOperationalEvidence(
  input: unknown,
): Readonly<PrivacyOperationalEvidence> {
  const snapshot = exactDataObject(input, [
    "plan",
    "startedAt",
    "completedAt",
    "status",
    "reasonCode",
    "stores",
    "artifactDeleted",
  ]);
  if (!snapshot || typeof snapshot.artifactDeleted !== "boolean") {
    throw new TypeError("Invalid privacy operational evidence");
  }
  const plan = snapshot.plan as Readonly<PrivacyWorkflowPlan>;
  assertPrivacyWorkflowPlan(plan);
  const startedAt = canonicalInstant(snapshot.startedAt);
  const completedAt = canonicalInstant(snapshot.completedAt);
  const status = z
    .enum(["completed", "blocked", "failed"])
    .safeParse(snapshot.status);
  const reason = PrivacyEvidenceReasonSchema.safeParse(snapshot.reasonCode);
  const stores = parseStoreEvidence(snapshot.stores);
  if (
    !startedAt ||
    !completedAt ||
    completedAt < startedAt ||
    !status.success ||
    !reason.success ||
    !stores ||
    (status.data === "completed") !== (reason.data === "NONE")
  ) {
    throw new TypeError("Invalid privacy operational evidence");
  }

  const totals = stores.reduce(
    (sum, store) => ({
      readRows: sum.readRows + store.readRows,
      scrubbedFields: sum.scrubbedFields + store.scrubbedFields,
      deletedRows: sum.deletedRows + store.deletedRows,
    }),
    { readRows: 0, scrubbedFields: 0, deletedRows: 0 },
  );
  if (
    totals.readRows > plan.rows ||
    totals.scrubbedFields > PRIVACY_MAX_TOTAL_ROWS ||
    totals.deletedRows > PRIVACY_MAX_TOTAL_ROWS
  ) {
    throw new TypeError("Invalid privacy operational evidence");
  }

  const evidence = Object.freeze({
    v: 1 as const,
    event: "privacy_operation_completed" as const,
    operation: plan.operation,
    environment: plan.environment,
    targetId: plan.targetId,
    startedAt,
    completedAt,
    status: status.data,
    reasonCode: reason.data,
    ...totals,
    storesVisited: stores.length,
    artifactDeleted: snapshot.artifactDeleted,
  });
  if (
    Buffer.byteLength(JSON.stringify(evidence), "utf8") >
    MAX_PRIVACY_OPERATIONAL_EVIDENCE_BYTES
  ) {
    throw new TypeError("Privacy operational evidence exceeds its byte bound");
  }
  issuedEvidence.add(evidence);
  return evidence;
}

export function serializePrivacyOperationalEvidence(
  evidence: Readonly<PrivacyOperationalEvidence>,
): string {
  if (!issuedEvidence.has(evidence)) {
    throw new TypeError("Unissued privacy operational evidence");
  }
  const line = `${JSON.stringify(evidence)}\n`;
  if (
    Buffer.byteLength(line, "utf8") > MAX_PRIVACY_OPERATIONAL_EVIDENCE_BYTES
  ) {
    throw new TypeError("Privacy operational evidence exceeds its byte bound");
  }
  return line;
}

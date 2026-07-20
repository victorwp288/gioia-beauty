import "server-only";

import { isDeepStrictEqual } from "node:util";

import { z } from "zod";

import { exactDataObject, exactDenseArray } from "../exactData.ts";

export const PRIVACY_DECISION_IDS = Object.freeze([
  "RET-01",
  "RET-02",
  "RET-03",
  "RET-04",
  "RET-05",
  "RET-06",
  "RET-07",
  "RET-08",
  "RET-09",
  "RET-10",
  "RET-11",
  "RET-12",
  "RET-13",
  "RET-14",
  "RET-15",
  "RET-16",
  "RET-17",
  "RET-HOLD",
] as const);

export type PrivacyDecisionId = (typeof PRIVACY_DECISION_IDS)[number];
export type PrivacyDecisionStatus = "pending" | "approved" | "rejected";

export interface PrivacyDecisionEvidence {
  readonly id: PrivacyDecisionId;
  readonly status: PrivacyDecisionStatus;
  readonly artifactDigest: string | null;
  readonly decidedAt: string | null;
}

export interface PrivacyDecisionRegistry {
  readonly version: 1;
  readonly decisions: readonly Readonly<PrivacyDecisionEvidence>[];
}

const DECISION_IDS = new Set<string>(PRIVACY_DECISION_IDS);
const DIGEST_PATTERN = /^[a-f0-9]{64}$/;
const ISO_INSTANT_PATTERN = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;
const issuedRegistries = new WeakSet<object>();

const DecisionSchema = z
  .object({
    id: z.enum(PRIVACY_DECISION_IDS),
    status: z.enum(["pending", "approved", "rejected"]),
    artifactDigest: z.string().regex(DIGEST_PATTERN).nullable(),
    decidedAt: z.string().regex(ISO_INSTANT_PATTERN).nullable(),
  })
  .strict()
  .superRefine((decision, context) => {
    const unresolved = decision.status === "pending";
    const hasAnyEvidence =
      decision.artifactDigest !== null || decision.decidedAt !== null;
    const missingEvidence =
      decision.artifactDigest === null || decision.decidedAt === null;
    if ((unresolved && hasAnyEvidence) || (!unresolved && missingEvidence)) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message:
          "Pending decisions cannot carry evidence; decided rows require it",
      });
    }
  });

function canonicalInstant(value: string): boolean {
  const milliseconds = Date.parse(value);
  return (
    Number.isFinite(milliseconds) &&
    new Date(milliseconds).toISOString() === value
  );
}

function parseDecision(value: unknown): Readonly<PrivacyDecisionEvidence> {
  const snapshot = exactDataObject(value, [
    "id",
    "status",
    "artifactDigest",
    "decidedAt",
  ]);
  if (!snapshot) throw new TypeError("Invalid privacy decision evidence");
  const candidate = { ...snapshot };
  const parsed = DecisionSchema.safeParse(candidate);
  if (
    !parsed.success ||
    !isDeepStrictEqual(candidate, parsed.data) ||
    (parsed.data.decidedAt !== null && !canonicalInstant(parsed.data.decidedAt))
  ) {
    throw new TypeError("Invalid privacy decision evidence");
  }
  return Object.freeze(parsed.data);
}

export function createPrivacyDecisionRegistry(
  value: unknown,
): Readonly<PrivacyDecisionRegistry> {
  const snapshot = exactDataObject(value, ["version", "decisions"]);
  const decisions = snapshot
    ? exactDenseArray(
        snapshot.decisions,
        PRIVACY_DECISION_IDS.length,
        PRIVACY_DECISION_IDS.length,
      )
    : null;
  if (snapshot?.version !== 1 || !decisions) {
    throw new TypeError("Invalid privacy decision registry");
  }

  const parsed = decisions.map(parseDecision);
  if (
    parsed.some(
      (decision, index) => decision.id !== PRIVACY_DECISION_IDS[index],
    ) ||
    new Set(parsed.map(({ id }) => id)).size !== PRIVACY_DECISION_IDS.length
  ) {
    throw new TypeError("Invalid privacy decision registry");
  }

  const registry = Object.freeze({
    version: 1 as const,
    decisions: Object.freeze(parsed),
  });
  issuedRegistries.add(registry);
  return registry;
}

export function assertPrivacyDecisionRegistry(
  registry: Readonly<PrivacyDecisionRegistry>,
): void {
  if (!issuedRegistries.has(registry)) {
    throw new TypeError("Unissued privacy decision registry");
  }
}

export function privacyDecisionStatus(
  registry: Readonly<PrivacyDecisionRegistry>,
  id: PrivacyDecisionId,
): PrivacyDecisionStatus {
  assertPrivacyDecisionRegistry(registry);
  if (!DECISION_IDS.has(id)) throw new TypeError("Unknown privacy decision");
  const decision = registry.decisions.find((candidate) => candidate.id === id);
  if (!decision) throw new TypeError("Missing privacy decision");
  return decision.status;
}

export function privacyDecisionManifestIsStructurallyApproved(
  registry: Readonly<PrivacyDecisionRegistry>,
): boolean {
  assertPrivacyDecisionRegistry(registry);
  return registry.decisions.every(({ status }) => status === "approved");
}

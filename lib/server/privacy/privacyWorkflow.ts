import "server-only";

import { isDeepStrictEqual } from "node:util";

import { z } from "zod";

import { exactDataObject, exactDenseArray } from "../exactData.ts";
import {
  assertPrivacyDecisionRegistry,
  privacyDecisionManifestIsStructurallyApproved,
  type PrivacyDecisionRegistry,
} from "./privacyDecisionRegistry.ts";

export const PRIVACY_MAX_SELECTORS = 3;
export const PRIVACY_MAX_ROWS_PER_PAGE = 100;
export const PRIVACY_MAX_PAGES_PER_STORE = 100;
export const PRIVACY_MAX_TOTAL_ROWS = 10_000;
export const PRIVACY_MAX_PLAINTEXT_BYTES = 25 * 1_024 * 1_024;

export const PRIVACY_SUBJECT_STORES = Object.freeze([
  "schedule_entries",
  "newsletter_subscribers",
  "email_outbox",
  "email_webhook_events",
  "command_requests",
  "domain_change_log",
  "migration_evidence",
  "owner_auth",
] as const);

const LOCAL_TARGET_ID = "gioia-beauty-local";
const TEST_TARGET_ID = "lxvsspniipcotimbsfqm";

type PrivacyOperation = "access" | "erasure_dry_run" | "erasure_apply";
const issuedPlans = new WeakSet<object>();

export type PrivacyWorkflowStopCode =
  | "IDENTITY_NOT_VERIFIED"
  | "BOUND_EXCEEDED"
  | "UNKNOWN_FIELD"
  | "IDENTIFIER_CONFLICT"
  | "AMBIGUOUS_SHARED_CONTACT"
  | "UNRESOLVED_QUARANTINE"
  | "INVALID_HOLD"
  | "ACTIVE_HOLD"
  | "FUTURE_BOOKING"
  | "ACTIVE_DELIVERY"
  | "UNPROCESSED_WEBHOOK"
  | "PROVIDER_RECONCILIATION_OPEN"
  | "RESTORE_REPLAY_GAP"
  | "POLICY_NOT_APPROVED";

export interface PrivacyWorkflowPlan {
  readonly version: 1;
  readonly authority: "none";
  readonly operation: PrivacyOperation;
  readonly caseId: string;
  readonly environment: "local" | "test";
  readonly targetId: typeof LOCAL_TARGET_ID | typeof TEST_TARGET_ID;
  readonly selectorCount: number;
  readonly rows: number;
  readonly plaintextBytes: number;
  readonly steps: readonly string[];
}

export type PrivacyWorkflowResult =
  | Readonly<{ ok: true; plan: Readonly<PrivacyWorkflowPlan> }>
  | Readonly<{ ok: false; code: PrivacyWorkflowStopCode }>;

const StoreCountSchema = z
  .object({
    store: z.enum(PRIVACY_SUBJECT_STORES),
    rows: z.number().int().min(0).max(PRIVACY_MAX_TOTAL_ROWS),
    pages: z.number().int().min(0).max(PRIVACY_MAX_PAGES_PER_STORE),
  })
  .strict();

const DiscoverySchema = z
  .object({
    stores: z.array(StoreCountSchema).length(PRIVACY_SUBJECT_STORES.length),
    plaintextBytes: z.number().int().min(0),
    hasUnknownFields: z.boolean(),
    hasIdentifierConflict: z.boolean(),
    hasAmbiguousSharedContact: z.boolean(),
    hasUnresolvedQuarantine: z.boolean(),
    hold: z.enum(["none", "valid", "invalid"]),
    hasFutureBooking: z.boolean(),
    hasActiveDelivery: z.boolean(),
    hasUnprocessedWebhook: z.boolean(),
    hasOpenProviderReconciliation: z.boolean(),
    restoreReplayReady: z.boolean(),
  })
  .strict();

const ACCESS_STEPS = Object.freeze([
  "query_exact_selectors",
  "render_encrypted_package",
  "verify_counts_and_provenance",
  "delete_working_copy",
]);
const ERASURE_DRY_RUN_STEPS = Object.freeze([
  "snapshot_exact_subject",
  "classify_dispositions",
  "verify_stop_conditions",
  "emit_protected_plan",
]);
const ERASURE_APPLY_STEPS = Object.freeze([
  "lock_subject_case",
  "apply_idempotent_dispositions",
  "reconcile_counts_and_invariants",
  "emit_deletion_receipt",
]);

function parseStores(value: unknown) {
  const source = exactDenseArray(
    value,
    PRIVACY_SUBJECT_STORES.length,
    PRIVACY_SUBJECT_STORES.length,
  );
  if (!source) return null;
  const stores = source.map((entry) => {
    const snapshot = exactDataObject(entry, ["store", "rows", "pages"]);
    if (!snapshot) return null;
    const candidate = { ...snapshot };
    const parsed = StoreCountSchema.safeParse(candidate);
    return parsed.success && isDeepStrictEqual(candidate, parsed.data)
      ? Object.freeze(parsed.data)
      : null;
  });
  if (
    stores.some((entry) => entry === null) ||
    stores.some(
      (entry, index) => entry?.store !== PRIVACY_SUBJECT_STORES[index],
    )
  ) {
    return null;
  }
  return Object.freeze(
    stores as readonly Readonly<z.infer<typeof StoreCountSchema>>[],
  );
}

function parseDiscovery(value: unknown) {
  const snapshot = exactDataObject(value, [
    "stores",
    "plaintextBytes",
    "hasUnknownFields",
    "hasIdentifierConflict",
    "hasAmbiguousSharedContact",
    "hasUnresolvedQuarantine",
    "hold",
    "hasFutureBooking",
    "hasActiveDelivery",
    "hasUnprocessedWebhook",
    "hasOpenProviderReconciliation",
    "restoreReplayReady",
  ]);
  const stores = snapshot ? parseStores(snapshot.stores) : null;
  if (!snapshot || !stores) return null;
  const candidate = { ...snapshot, stores: [...stores] };
  const parsed = DiscoverySchema.safeParse(candidate);
  if (!parsed.success || !isDeepStrictEqual(candidate, parsed.data))
    return null;
  return Object.freeze({ ...parsed.data, stores });
}

function blocked(code: PrivacyWorkflowStopCode): PrivacyWorkflowResult {
  return Object.freeze({ ok: false as const, code });
}

export function createPrivacyWorkflowPlan(
  input: unknown,
): PrivacyWorkflowResult {
  const snapshot = exactDataObject(input, [
    "version",
    "operation",
    "caseId",
    "environment",
    "targetId",
    "selectorCount",
    "identityVerified",
    "discovery",
    "decisionRegistry",
  ]);
  if (!snapshot || snapshot.version !== 1) {
    throw new TypeError("Invalid privacy workflow input");
  }
  const operation = z
    .enum(["access", "erasure_dry_run", "erasure_apply"])
    .safeParse(snapshot.operation);
  const caseId = z.string().uuid().safeParse(snapshot.caseId);
  const selectorCount = z
    .number()
    .int()
    .min(1)
    .max(PRIVACY_MAX_SELECTORS)
    .safeParse(snapshot.selectorCount);
  const discovery = parseDiscovery(snapshot.discovery);
  const validTarget =
    (snapshot.environment === "local" &&
      snapshot.targetId === LOCAL_TARGET_ID) ||
    (snapshot.environment === "test" && snapshot.targetId === TEST_TARGET_ID);
  if (
    !operation.success ||
    !caseId.success ||
    !selectorCount.success ||
    typeof snapshot.identityVerified !== "boolean" ||
    !discovery ||
    !validTarget
  ) {
    throw new TypeError("Invalid privacy workflow input");
  }

  if (!snapshot.identityVerified) return blocked("IDENTITY_NOT_VERIFIED");
  const rows = discovery.stores.reduce((total, store) => total + store.rows, 0);
  const pagesAreConsistent = discovery.stores.every(
    ({ rows: count, pages }) =>
      pages === Math.ceil(count / PRIVACY_MAX_ROWS_PER_PAGE),
  );
  if (
    rows > PRIVACY_MAX_TOTAL_ROWS ||
    discovery.plaintextBytes > PRIVACY_MAX_PLAINTEXT_BYTES ||
    !pagesAreConsistent
  ) {
    return blocked("BOUND_EXCEEDED");
  }
  if (discovery.hasUnknownFields) return blocked("UNKNOWN_FIELD");
  if (discovery.hasIdentifierConflict) return blocked("IDENTIFIER_CONFLICT");
  if (discovery.hasAmbiguousSharedContact) {
    return blocked("AMBIGUOUS_SHARED_CONTACT");
  }
  if (discovery.hasUnresolvedQuarantine)
    return blocked("UNRESOLVED_QUARANTINE");
  if (discovery.hold === "invalid") return blocked("INVALID_HOLD");

  let steps = ACCESS_STEPS;
  if (operation.data === "erasure_dry_run") steps = ERASURE_DRY_RUN_STEPS;
  if (operation.data === "erasure_apply") {
    if (discovery.hold === "valid") return blocked("ACTIVE_HOLD");
    if (discovery.hasFutureBooking) return blocked("FUTURE_BOOKING");
    if (discovery.hasActiveDelivery) return blocked("ACTIVE_DELIVERY");
    if (discovery.hasUnprocessedWebhook) return blocked("UNPROCESSED_WEBHOOK");
    if (discovery.hasOpenProviderReconciliation) {
      return blocked("PROVIDER_RECONCILIATION_OPEN");
    }
    if (!discovery.restoreReplayReady) return blocked("RESTORE_REPLAY_GAP");
    try {
      assertPrivacyDecisionRegistry(
        snapshot.decisionRegistry as Readonly<PrivacyDecisionRegistry>,
      );
      if (
        !privacyDecisionManifestIsStructurallyApproved(
          snapshot.decisionRegistry as Readonly<PrivacyDecisionRegistry>,
        )
      ) {
        return blocked("POLICY_NOT_APPROVED");
      }
    } catch {
      return blocked("POLICY_NOT_APPROVED");
    }
    steps = ERASURE_APPLY_STEPS;
  } else if (snapshot.decisionRegistry !== null) {
    throw new TypeError("Non-apply workflows cannot carry a decision registry");
  }

  const plan = Object.freeze({
    version: 1 as const,
    authority: "none" as const,
    operation: operation.data,
    caseId: caseId.data,
    environment: snapshot.environment as "local" | "test",
    targetId: snapshot.targetId as
      typeof LOCAL_TARGET_ID | typeof TEST_TARGET_ID,
    selectorCount: selectorCount.data,
    rows,
    plaintextBytes: discovery.plaintextBytes,
    steps,
  });
  issuedPlans.add(plan);
  return Object.freeze({
    ok: true as const,
    plan,
  });
}

export function assertPrivacyWorkflowPlan(
  plan: Readonly<PrivacyWorkflowPlan>,
): void {
  if (!issuedPlans.has(plan))
    throw new TypeError("Unissued privacy workflow plan");
}

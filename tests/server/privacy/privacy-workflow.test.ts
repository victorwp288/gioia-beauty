import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import {
  createPrivacyDecisionRegistry,
  PRIVACY_DECISION_IDS,
} from "@/lib/server/privacy/privacyDecisionRegistry.ts";
import {
  createPrivacyWorkflowPlan,
  PRIVACY_MAX_PLAINTEXT_BYTES,
  PRIVACY_SUBJECT_STORES,
} from "@/lib/server/privacy/privacyWorkflow.ts";

const CASE_ID = "11111111-1111-4111-8111-111111111111";
const CREATED_AT = "2035-01-02T03:04:05.000Z";

function decisionRegistry(status: "pending" | "approved" = "pending") {
  return createPrivacyDecisionRegistry({
    version: 1,
    decisions: PRIVACY_DECISION_IDS.map((id) => ({
      id,
      status,
      artifactDigest: status === "approved" ? "a".repeat(64) : null,
      decidedAt: status === "approved" ? CREATED_AT : null,
    })),
  });
}

function discovery(overrides: Record<string, unknown> = {}) {
  return {
    stores: PRIVACY_SUBJECT_STORES.map((store, index) => ({
      store,
      rows: index === 0 ? 2 : 0,
      pages: index === 0 ? 1 : 0,
    })),
    plaintextBytes: 512,
    hasUnknownFields: false,
    hasIdentifierConflict: false,
    hasAmbiguousSharedContact: false,
    hasUnresolvedQuarantine: false,
    hold: "none",
    hasFutureBooking: false,
    hasActiveDelivery: false,
    hasUnprocessedWebhook: false,
    hasOpenProviderReconciliation: false,
    restoreReplayReady: true,
    ...overrides,
  };
}

function input(overrides: Record<string, unknown> = {}) {
  return {
    version: 1,
    operation: "access",
    caseId: CASE_ID,
    environment: "local",
    targetId: "gioia-beauty-local",
    selectorCount: 2,
    identityVerified: true,
    discovery: discovery(),
    decisionRegistry: null,
    ...overrides,
  };
}

describe("privacy access and erasure workflow", () => {
  it("issues a fixed bounded synthetic access plan", () => {
    const result = createPrivacyWorkflowPlan(input());

    expect(result).toEqual({
      ok: true,
      plan: {
        version: 1,
        authority: "none",
        operation: "access",
        caseId: CASE_ID,
        environment: "local",
        targetId: "gioia-beauty-local",
        selectorCount: 2,
        rows: 2,
        plaintextBytes: 512,
        steps: [
          "query_exact_selectors",
          "render_encrypted_package",
          "verify_counts_and_provenance",
          "delete_working_copy",
        ],
      },
    });
    expect(Object.isFrozen(result)).toBe(true);
    if (result.ok) expect(Object.isFrozen(result.plan)).toBe(true);
  });

  it("permits only the exact allowlisted Local and TEST target identities", () => {
    expect(
      createPrivacyWorkflowPlan(
        input({ environment: "test", targetId: "lxvsspniipcotimbsfqm" }),
      ),
    ).toMatchObject({ ok: true, plan: { environment: "test" } });
    for (const target of [
      { environment: "production", targetId: "gioia-beauty-b95e0" },
      { environment: "test", targetId: "another-project" },
      { environment: "local", targetId: "lxvsspniipcotimbsfqm" },
    ]) {
      expect(() => createPrivacyWorkflowPlan(input(target))).toThrow(
        "Invalid privacy workflow input",
      );
    }
  });

  it.each([
    ["IDENTITY_NOT_VERIFIED", { identityVerified: false }],
    ["UNKNOWN_FIELD", { discovery: discovery({ hasUnknownFields: true }) }],
    [
      "IDENTIFIER_CONFLICT",
      { discovery: discovery({ hasIdentifierConflict: true }) },
    ],
    [
      "AMBIGUOUS_SHARED_CONTACT",
      { discovery: discovery({ hasAmbiguousSharedContact: true }) },
    ],
    [
      "UNRESOLVED_QUARANTINE",
      { discovery: discovery({ hasUnresolvedQuarantine: true }) },
    ],
    ["INVALID_HOLD", { discovery: discovery({ hold: "invalid" }) }],
  ])("fails closed with %s", (code, overrides) => {
    expect(createPrivacyWorkflowPlan(input(overrides))).toEqual({
      ok: false,
      code,
    });
  });

  it("enforces aggregate row, page, byte, and selector bounds", () => {
    const overRows = PRIVACY_SUBJECT_STORES.map((store) => ({
      store,
      rows: 2_000,
      pages: 20,
    }));
    expect(
      createPrivacyWorkflowPlan(
        input({ discovery: discovery({ stores: overRows }) }),
      ),
    ).toEqual({ ok: false, code: "BOUND_EXCEEDED" });
    expect(
      createPrivacyWorkflowPlan(
        input({
          discovery: discovery({
            plaintextBytes: PRIVACY_MAX_PLAINTEXT_BYTES + 1,
          }),
        }),
      ),
    ).toEqual({ ok: false, code: "BOUND_EXCEEDED" });
    expect(
      createPrivacyWorkflowPlan(
        input({
          discovery: discovery({
            stores: PRIVACY_SUBJECT_STORES.map((store, index) => ({
              store,
              rows: index === 0 ? 101 : 0,
              pages: index === 0 ? 1 : 0,
            })),
          }),
        }),
      ),
    ).toEqual({ ok: false, code: "BOUND_EXCEEDED" });
    expect(() =>
      createPrivacyWorkflowPlan(input({ selectorCount: 4 })),
    ).toThrow("Invalid privacy workflow input");
  });

  it("issues a dry-run plan without authorizing mutation", () => {
    const result = createPrivacyWorkflowPlan(
      input({
        operation: "erasure_dry_run",
        discovery: discovery({
          hold: "valid",
          hasFutureBooking: true,
          hasActiveDelivery: true,
        }),
      }),
    );

    expect(result).toMatchObject({
      ok: true,
      plan: {
        operation: "erasure_dry_run",
        steps: [
          "snapshot_exact_subject",
          "classify_dispositions",
          "verify_stop_conditions",
          "emit_protected_plan",
        ],
      },
    });
  });

  it.each([
    ["ACTIVE_HOLD", { hold: "valid" }],
    ["FUTURE_BOOKING", { hasFutureBooking: true }],
    ["ACTIVE_DELIVERY", { hasActiveDelivery: true }],
    ["UNPROCESSED_WEBHOOK", { hasUnprocessedWebhook: true }],
    ["PROVIDER_RECONCILIATION_OPEN", { hasOpenProviderReconciliation: true }],
    ["RESTORE_REPLAY_GAP", { restoreReplayReady: false }],
  ])("blocks erasure apply on %s", (code, discoveryOverrides) => {
    expect(
      createPrivacyWorkflowPlan(
        input({
          operation: "erasure_apply",
          discovery: discovery(discoveryOverrides),
          decisionRegistry: decisionRegistry("approved"),
        }),
      ),
    ).toEqual({ ok: false, code });
  });

  it("requires a complete issued approved decision registry before apply", () => {
    for (const candidate of [null, decisionRegistry(), { decisions: [] }]) {
      expect(
        createPrivacyWorkflowPlan(
          input({
            operation: "erasure_apply",
            decisionRegistry: candidate,
          }),
        ),
      ).toEqual({ ok: false, code: "POLICY_NOT_APPROVED" });
    }
    expect(
      createPrivacyWorkflowPlan(
        input({
          operation: "erasure_apply",
          decisionRegistry: decisionRegistry("approved"),
        }),
      ),
    ).toMatchObject({
      ok: true,
      plan: {
        operation: "erasure_apply",
        steps: [
          "lock_subject_case",
          "apply_idempotent_dispositions",
          "reconcile_counts_and_invariants",
          "emit_deletion_receipt",
        ],
      },
    });
  });

  it("rejects surplus and accessor-bearing inputs without reading PII", () => {
    const getter = vi.fn(() => "customer@example.test");
    const candidate = input();
    Object.defineProperty(candidate, "email", {
      enumerable: true,
      get: getter,
    });

    expect(() => createPrivacyWorkflowPlan(candidate)).toThrow(
      "Invalid privacy workflow input",
    );
    expect(getter).not.toHaveBeenCalled();
  });
});

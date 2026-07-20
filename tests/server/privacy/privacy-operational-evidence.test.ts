import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import {
  createPrivacyOperationalEvidence,
  serializePrivacyOperationalEvidence,
} from "@/lib/server/privacy/privacyOperationalEvidence.ts";
import {
  createPrivacyWorkflowPlan,
  PRIVACY_SUBJECT_STORES,
} from "@/lib/server/privacy/privacyWorkflow.ts";

const CASE_ID = "11111111-1111-4111-8111-111111111111";

function plan() {
  const result = createPrivacyWorkflowPlan({
    version: 1,
    operation: "access",
    caseId: CASE_ID,
    environment: "local",
    targetId: "gioia-beauty-local",
    selectorCount: 1,
    identityVerified: true,
    discovery: {
      stores: PRIVACY_SUBJECT_STORES.map((store, index) => ({
        store,
        rows: index === 0 ? 2 : 0,
        pages: index === 0 ? 1 : 0,
      })),
      plaintextBytes: 128,
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
    },
    decisionRegistry: null,
  });
  if (!result.ok) throw new Error("unexpected blocked fixture");
  return result.plan;
}

function input(overrides: Record<string, unknown> = {}) {
  return {
    plan: plan(),
    startedAt: "2035-01-02T03:04:06.000Z",
    completedAt: "2035-01-02T03:04:07.000Z",
    status: "completed",
    reasonCode: "NONE",
    stores: [
      {
        store: "schedule_entries",
        readRows: 2,
        scrubbedFields: 0,
        deletedRows: 0,
      },
    ],
    artifactDeleted: true,
    ...overrides,
  };
}

describe("privacy operational evidence", () => {
  it("derives a fixed minimized artifact without its protected case identity", () => {
    const evidence = createPrivacyOperationalEvidence(input());
    const line = serializePrivacyOperationalEvidence(evidence);

    expect(evidence).toEqual({
      v: 1,
      event: "privacy_operation_completed",
      operation: "access",
      environment: "local",
      targetId: "gioia-beauty-local",
      startedAt: "2035-01-02T03:04:06.000Z",
      completedAt: "2035-01-02T03:04:07.000Z",
      status: "completed",
      reasonCode: "NONE",
      readRows: 2,
      scrubbedFields: 0,
      deletedRows: 0,
      storesVisited: 1,
      artifactDeleted: true,
    });
    expect(Object.isFrozen(evidence)).toBe(true);
    expect(line.endsWith("\n")).toBe(true);
    expect(JSON.parse(line)).toEqual(evidence);
    expect(line).not.toContain(CASE_ID);
    expect(line).not.toMatch(/email|phone|selector|note|token|secret|cookie/i);
  });

  it("supports fixed blocked and failed reason codes", () => {
    expect(
      createPrivacyOperationalEvidence(
        input({ status: "blocked", reasonCode: "ACTIVE_HOLD" }),
      ),
    ).toMatchObject({ status: "blocked", reasonCode: "ACTIVE_HOLD" });
    expect(
      createPrivacyOperationalEvidence(
        input({ status: "failed", reasonCode: "INTERNAL_FAILURE" }),
      ),
    ).toMatchObject({ status: "failed", reasonCode: "INTERNAL_FAILURE" });
  });

  it.each([
    ["completed with a failure reason", { reasonCode: "ACTIVE_HOLD" }],
    ["blocked without a reason", { status: "blocked", reasonCode: "NONE" }],
    ["time regression", { completedAt: "2035-01-02T03:04:05.000Z" }],
    ["non-canonical time", { completedAt: "2035-01-02T03:04:07Z" }],
    [
      "more rows than the issued plan",
      {
        stores: [
          {
            store: "schedule_entries",
            readRows: 3,
            scrubbedFields: 0,
            deletedRows: 0,
          },
        ],
      },
    ],
    [
      "duplicate stores",
      {
        stores: [
          {
            store: "schedule_entries",
            readRows: 1,
            scrubbedFields: 0,
            deletedRows: 0,
          },
          {
            store: "schedule_entries",
            readRows: 1,
            scrubbedFields: 0,
            deletedRows: 0,
          },
        ],
      },
    ],
  ])("rejects %s", (_label, overrides) => {
    expect(() => createPrivacyOperationalEvidence(input(overrides))).toThrow(
      "Invalid privacy operational evidence",
    );
  });

  it("rejects unissued plans and forged evidence", () => {
    expect(() =>
      createPrivacyOperationalEvidence(input({ plan: { ...plan() } })),
    ).toThrow("Unissued privacy workflow plan");
    const evidence = createPrivacyOperationalEvidence(input());
    expect(() => serializePrivacyOperationalEvidence({ ...evidence })).toThrow(
      "Unissued privacy operational evidence",
    );
  });

  it("rejects surplus/accessor fields without reading PII", () => {
    const getter = vi.fn(() => "customer@example.test");
    const candidate = input();
    Object.defineProperty(candidate, "email", {
      enumerable: true,
      get: getter,
    });

    expect(() => createPrivacyOperationalEvidence(candidate)).toThrow(
      "Invalid privacy operational evidence",
    );
    expect(getter).not.toHaveBeenCalled();
  });
});

import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import {
  createPrivacyDecisionRegistry,
  PRIVACY_DECISION_IDS,
  privacyDecisionStatus,
  privacyDecisionManifestIsStructurallyApproved,
} from "@/lib/server/privacy/privacyDecisionRegistry.ts";

const DIGEST = "a".repeat(64);
const DECIDED_AT = "2035-01-02T03:04:05.000Z";

function decisions(status: "pending" | "approved" | "rejected" = "pending") {
  return PRIVACY_DECISION_IDS.map((id) => ({
    id,
    status,
    artifactDigest: status === "pending" ? null : DIGEST,
    decidedAt: status === "pending" ? null : DECIDED_AT,
  }));
}

function registry(status: "pending" | "approved" | "rejected" = "pending") {
  return createPrivacyDecisionRegistry({
    version: 1,
    decisions: decisions(status),
  });
}

describe("privacy decision registry", () => {
  it("preserves every decision as pending without inventing policy values", () => {
    const result = registry();

    expect(result.decisions).toHaveLength(18);
    expect(result.decisions.map(({ id }) => id)).toEqual(PRIVACY_DECISION_IDS);
    expect(result.decisions.every(({ status }) => status === "pending")).toBe(
      true,
    );
    expect(privacyDecisionManifestIsStructurallyApproved(result)).toBe(false);
    expect(privacyDecisionStatus(result, "RET-HOLD")).toBe("pending");
    expect(Object.isFrozen(result)).toBe(true);
    expect(Object.isFrozen(result.decisions)).toBe(true);
  });

  it("accepts a synthetic fully approved evidence manifest", () => {
    const result = registry("approved");

    expect(privacyDecisionManifestIsStructurallyApproved(result)).toBe(true);
    expect(privacyDecisionStatus(result, "RET-01")).toBe("approved");
  });

  it.each([
    ["missing decision", decisions().slice(1)],
    ["duplicate decision", [...decisions().slice(0, -1), decisions()[0]]],
    ["reordered decisions", [...decisions()].reverse()],
    [
      "pending decision with evidence",
      decisions().map((entry, index) =>
        index === 0 ? { ...entry, artifactDigest: DIGEST } : entry,
      ),
    ],
    [
      "decided row without complete evidence",
      decisions().map((entry, index) =>
        index === 0
          ? { ...entry, status: "approved", decidedAt: DECIDED_AT }
          : entry,
      ),
    ],
    [
      "non-canonical instant",
      decisions("approved").map((entry, index) =>
        index === 0 ? { ...entry, decidedAt: "2035-01-02T03:04:05Z" } : entry,
      ),
    ],
  ])("rejects %s", (_label, candidate) => {
    expect(() =>
      createPrivacyDecisionRegistry({ version: 1, decisions: candidate }),
    ).toThrow("Invalid privacy decision");
  });

  it("rejects surplus and accessor data without reading it", () => {
    const getter = vi.fn(() => "customer@example.test");
    const first = { ...decisions()[0] };
    Object.defineProperty(first, "secret", { enumerable: true, get: getter });
    const candidate = [first, ...decisions().slice(1)];

    expect(() =>
      createPrivacyDecisionRegistry({ version: 1, decisions: candidate }),
    ).toThrow("Invalid privacy decision");
    expect(getter).not.toHaveBeenCalled();
    expect(() =>
      createPrivacyDecisionRegistry({
        version: 1,
        decisions: decisions(),
        email: "customer@example.test",
      }),
    ).toThrow("Invalid privacy decision registry");
  });

  it("rejects forged registries at the approval boundary", () => {
    const forged = { version: 1 as const, decisions: decisions("approved") };
    expect(() => privacyDecisionManifestIsStructurallyApproved(forged)).toThrow(
      "Unissued privacy decision registry",
    );
  });
});

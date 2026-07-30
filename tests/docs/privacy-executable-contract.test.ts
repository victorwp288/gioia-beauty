import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

const privacy = readFileSync(resolve("docs/PRIVACY-OPERATIONS.md"), "utf8");
const operations = readFileSync(resolve("docs/OPERATIONS.md"), "utf8");

describe("local privacy and observability contract documentation", () => {
  it("links every executable privacy contract while preserving non-authorization", () => {
    for (const file of [
      "privacyDecisionRegistry.ts",
      "privacyWorkflow.ts",
      "privacyOperationalEvidence.ts",
    ]) {
      expect(privacy).toContain(`\`${file}\``);
      expect(existsSync(resolve("lib/server/privacy", file))).toBe(true);
    }
    expect(privacy).toContain("No Production target is registered");
    expect(privacy).toContain(
      "perform no database, Auth, filesystem, network, provider",
    );
    expect(privacy).toContain("No acceptance item is completed");
    expect(privacy).toContain("Pending decisions carry no invented");
  });

  it("records the authorized Preview sinks without claiming Production readiness", () => {
    expect(operations).toContain("handled 5xx responses");
    expect(operations).toContain(
      "Local, Test, and operator environments reject",
    );
    expect(operations).toContain("Production has no");
    expect(operations).toContain(
      "PII-minimized/personless operational telemetry",
    );
    expect(operations).toContain(
      "retention/deletion evidence,\nsynthetic test-fire",
    );
  });
});

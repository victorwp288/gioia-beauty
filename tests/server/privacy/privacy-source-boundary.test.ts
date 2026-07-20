import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

const FILES = [
  "privacyDecisionRegistry.ts",
  "privacyWorkflow.ts",
  "privacyOperationalEvidence.ts",
] as const;

describe("privacy source boundary", () => {
  it.each(FILES)("keeps %s server-only, small, and locally inert", (file) => {
    const source = readFileSync(resolve("lib/server/privacy", file), "utf8");

    expect(source.startsWith('import "server-only";')).toBe(true);
    expect(source.split("\n").length).toBeLessThanOrEqual(300);
    expect(source).not.toMatch(
      /console\.|process\.env|process\.stdout|process\.stderr/,
    );
    expect(source).not.toMatch(/fetch\s*\(|@sentry|supabase|firebase|resend/i);
    expect(source).not.toMatch(/\b(?:writeFile|appendFile|unlink|rmSync)\b/);
    expect(source).not.toMatch(/\b(?:setTimeout|setInterval|queueMicrotask)\b/);
  });
});

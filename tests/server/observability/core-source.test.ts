import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

const CORE_FILES = [
  "contracts.ts",
  "safeSink.ts",
  "structuredLogger.ts",
  "errorReporter.ts",
  "routeMetrics.ts",
] as const;

function source(file: (typeof CORE_FILES)[number]): string {
  return readFileSync(resolve("lib/server/observability", file), "utf8");
}

describe("observability core source boundary", () => {
  it.each(CORE_FILES)("keeps %s server-only and small", (file) => {
    const text = source(file);

    expect(text.startsWith('import "server-only";')).toBe(true);
    expect(text.split("\n").length).toBeLessThanOrEqual(300);
  });

  it.each(CORE_FILES)(
    "keeps %s provider-free and operationally inert",
    (file) => {
      const text = source(file);

      expect(text).not.toMatch(/@sentry|\bdsn\b|console\.|process\.env/i);
      expect(text).not.toMatch(/process\.stdout|fetch\s*\(/);
      expect(text).not.toMatch(/\b(?:setTimeout|setInterval|queueMicrotask)\b/);
      expect(text).not.toMatch(/\b(?:NextRequest|Request)\b/);
    },
  );

  it("installs only the approved server-side provider dependencies", () => {
    const packageJson = readFileSync(resolve("package.json"), "utf8");

    expect(packageJson).toContain('"@sentry/node": "10.69.0"');
    expect(packageJson).toContain('"posthog-node": "5.21.2"');
    expect(packageJson).not.toMatch(
      /"@sentry\/(?:nextjs|browser)|"posthog-js"|"posthog-js-lite"/,
    );
  });
});

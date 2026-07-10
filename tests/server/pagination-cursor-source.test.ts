import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

const ROOT = process.cwd();
const SERVER_FILES = [
  "lib/server/exactData.ts",
  "lib/server/paginationCursor.ts",
  "lib/server/paginationCursorFingerprint.ts",
  "lib/server/paginationCursorKeyring.ts",
  "lib/server/paginationCursorPayload.ts",
];

function source(relativePath: string): string {
  return readFileSync(resolve(ROOT, relativePath), "utf8");
}

describe("pagination cursor source boundary", () => {
  it.each(SERVER_FILES)("keeps %s server-only and dependency-light", (file) => {
    const text = source(file);
    expect(text.startsWith('import "server-only";')).toBe(true);
    for (const forbidden of [
      "process.env",
      "fetch(",
      "console.",
      "database/runtime",
      "@/lib/cache",
      "Provider",
      "export const paginationCursorCodec",
    ]) {
      expect(text).not.toContain(forbidden);
    }
  });

  it("checks a fixed-size decoded tag before timing-safe comparison and parsing", () => {
    const text = source("lib/server/paginationCursor.ts");
    const decode = text.indexOf("const actual = decodedSignature");
    const length = text.indexOf("actual.length !== expected.length", decode);
    const compare = text.indexOf("timingSafeEqual(actual, expected)", length);
    const parse = text.indexOf(
      "parseCanonicalPaginationCursorPayload",
      compare,
    );

    expect(decode).toBeGreaterThan(0);
    expect(length).toBeGreaterThan(decode);
    expect(compare).toBeGreaterThan(length);
    expect(parse).toBeGreaterThan(compare);
  });

  it("does not retain authority-confusing unauthenticated cursor names", () => {
    const text = [
      source("lib/domain/schemas/cursors.ts"),
      source("lib/server/paginationCursor.ts"),
    ].join("\n");
    expect(text).not.toMatch(/SignedCursor|VerifiedCursor|parseVerifiedCursor/);
  });
});

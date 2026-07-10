import { existsSync, readFileSync, readdirSync } from "node:fs";
import { extname, resolve } from "node:path";

import { describe, expect, it } from "vitest";

const ROOT = process.cwd();
const MODULE_NAMES = [
  "ownerScheduleReadContract",
  "ownerScheduleListResponseContract",
  "ownerScheduleCountReadContract",
] as const;

function sourceFiles(path: string): string[] {
  return readdirSync(path, { withFileTypes: true }).flatMap((entry) => {
    const target = resolve(path, entry.name);
    if (entry.isDirectory()) return sourceFiles(target);
    return [
      ".js",
      ".jsx",
      ".json",
      ".mjs",
      ".ts",
      ".tsx",
      ".yaml",
      ".yml",
    ].includes(extname(target))
      ? [target]
      : [];
  });
}

describe("owner schedule read contract source boundary", () => {
  it.each(MODULE_NAMES)(
    "keeps %s server-only and operationally inert",
    (name) => {
      const source = readFileSync(
        resolve(ROOT, `lib/server/database/${name}.ts`),
        "utf8",
      );
      expect(source.startsWith('import "server-only";')).toBe(true);
      expect(source.split("\n").length).toBeLessThanOrEqual(300);
      for (const forbidden of [
        "process.env",
        "fetch(",
        "console.",
        "createRuntimeDatabase",
        "ownerTransaction",
        "freshOwnerSession",
        "next/headers",
        "setTimeout",
      ]) {
        expect(source).not.toContain(forbidden);
      }
    },
  );

  it("has no production importer, route, UI activation, script, or workflow", () => {
    const contractPaths = new Set(
      MODULE_NAMES.map((name) =>
        resolve(ROOT, `lib/server/database/${name}.ts`),
      ),
    );
    const productionDirectories = [
      ".github",
      "app",
      "components",
      "config",
      "context",
      "data",
      "hooks",
      "lib",
      "pages",
      "scripts",
      "src",
    ]
      .map((path) => resolve(ROOT, path))
      .filter(existsSync);
    const rootSources = readdirSync(ROOT, { withFileTypes: true })
      .filter(
        (entry) =>
          entry.isFile() &&
          [".js", ".json", ".mjs", ".ts", ".yaml", ".yml"].includes(
            extname(entry.name),
          ),
      )
      .map((entry) => resolve(ROOT, entry.name));
    const productionSources = [
      ...productionDirectories.flatMap(sourceFiles),
      ...rootSources,
    ].filter((path) => !contractPaths.has(path));

    expect(
      productionSources.filter((path) => {
        const source = readFileSync(path, "utf8");
        return MODULE_NAMES.some((name) => source.includes(name));
      }),
    ).toEqual([]);
    for (const extension of ["js", "jsx", "ts", "tsx"]) {
      expect(
        existsSync(resolve(ROOT, `app/api/admin/schedule/route.${extension}`)),
      ).toBe(false);
      expect(
        existsSync(
          resolve(ROOT, `app/api/admin/schedule/count/route.${extension}`),
        ),
      ).toBe(false);
    }
  });
});

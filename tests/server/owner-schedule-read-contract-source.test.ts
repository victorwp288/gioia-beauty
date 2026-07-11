import { existsSync, readFileSync, readdirSync } from "node:fs";
import { extname, resolve } from "node:path";

import { describe, expect, it } from "vitest";

const ROOT = process.cwd();
const CONTRACT_NAMES = [
  "ownerScheduleReadContract",
  "ownerScheduleListResponseContract",
  "ownerScheduleCountReadContract",
  "ownerScheduleExportReadContract",
  "ownerScheduleExportResponseContract",
  "ownerSubscriberReadContract",
  "ownerSubscriberListResponseContract",
  "ownerVacationReadContract",
  "ownerVacationListResponseContract",
] as const;
const HANDLER_NAMES = [
  "ownerScheduleReadHandler",
  "ownerScheduleReadHandlerSupport",
  "ownerScheduleReadAuthorization",
  "ownerScheduleExportHandler",
  "ownerVacationSubscriberReadHandler",
] as const;
const MODULE_NAMES = [...CONTRACT_NAMES, ...HANDLER_NAMES] as const;

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
  it.each(CONTRACT_NAMES)(
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

  it.each(HANDLER_NAMES)("keeps %s server-only and inert", (name) => {
    const source = readFileSync(resolve(ROOT, `lib/server/${name}.ts`), "utf8");
    expect(source.startsWith('import "server-only";')).toBe(true);
    expect(source.split("\n").length).toBeLessThanOrEqual(300);
    for (const forbidden of [
      "process.env",
      "fetch(",
      "console.",
      "createRuntimeDatabase",
      "ownerTransaction",
      "ownerAuthRepository",
      "next/headers",
      "setTimeout",
    ]) {
      expect(source).not.toContain(forbidden);
    }
  });

  it("has no production importer, route, UI activation, script, or workflow", () => {
    const modulePaths = new Set([
      ...CONTRACT_NAMES.map((name) =>
        resolve(ROOT, `lib/server/database/${name}.ts`),
      ),
      ...HANDLER_NAMES.map((name) => resolve(ROOT, `lib/server/${name}.ts`)),
    ]);
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
    ].filter((path) => !modulePaths.has(path));

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

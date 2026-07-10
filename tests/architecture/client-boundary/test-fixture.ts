import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

import { auditClientServerBoundary } from "../client-server-boundary.ts";
import type { BoundaryViolationCode } from "./contracts.ts";

const temporaryRoots: string[] = [];

export function cleanupFixtures(): void {
  for (const root of temporaryRoots.splice(0)) {
    rmSync(root, { force: true, recursive: true });
  }
}

export function fixture(files: Readonly<Record<string, string>>): string {
  const root = mkdtempSync(join(tmpdir(), "gioia-client-boundary-"));
  temporaryRoots.push(root);
  for (const [path, contents] of Object.entries(files)) {
    const absolutePath = join(root, path);
    mkdirSync(dirname(absolutePath), { recursive: true });
    writeFileSync(absolutePath, contents, "utf8");
  }
  return root;
}

export function violationCodes(
  files: Readonly<Record<string, string>>,
): BoundaryViolationCode[] {
  return auditClientServerBoundary({ rootDir: fixture(files) }).map(
    ({ code }) => code,
  );
}

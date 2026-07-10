import { realpathSync } from "node:fs";
import { resolve } from "node:path";

import {
  type BoundaryViolation,
  type ClientServerBoundaryOptions,
} from "./contracts.ts";
import {
  forbiddenDynamicCode,
  forbiddenEnvironmentAccesses,
  forbiddenGlobalObjectAliases,
} from "./client-policy.ts";
import { runtimeImports } from "./module-edges.ts";
import {
  databaseBoundaryViolations,
  forbiddenPathCode,
  isBuiltinPackage,
  isForbiddenPackage,
  isLocalSpecifier,
  isUnsafeImportSpecifier,
  resolveLocalImport,
} from "./resolver.ts";
import {
  displayPath,
  hasUseClientDirective,
  productionSourcePaths,
  productionSourceSymlinks,
  readSourceFile,
  sourceParseDiagnostics,
  sourcePaths,
  sourceSymlinks,
} from "./source-files.ts";

interface QueueEntry {
  readonly path: string;
  readonly chain: readonly string[];
}

function compareViolations(
  left: BoundaryViolation,
  right: BoundaryViolation,
): number {
  return (
    left.module.localeCompare(right.module) ||
    left.code.localeCompare(right.code) ||
    left.detail.localeCompare(right.detail) ||
    left.chain.join(" -> ").localeCompare(right.chain.join(" -> "))
  );
}

export function auditClientServerBoundary({
  rootDir,
  entryRoots,
}: ClientServerBoundaryOptions): BoundaryViolation[] {
  const root = realpathSync(rootDir);
  const productionSources = entryRoots
    ? entryRoots.flatMap((entryRoot) => sourcePaths(resolve(root, entryRoot)))
    : productionSourcePaths(root);
  const violations = databaseBoundaryViolations(
    root,
    resolve(root, "lib/server/database"),
  );

  for (const path of productionSources) {
    if (sourceParseDiagnostics(readSourceFile(path)).length > 0) {
      const modulePath = displayPath(root, path);
      violations.push({
        code: "SOURCE_PARSE_ERROR",
        module: modulePath,
        detail: "source could not be parsed deterministically",
        chain: [modulePath],
      });
    }
  }

  const entries = productionSources
    .filter((path) => {
      const source = readSourceFile(path);
      const normalized = displayPath(root, path);
      return (
        hasUseClientDirective(source) ||
        normalized.startsWith("lib/client/") ||
        runtimeImports(source).some(
          ({ specifier }) => specifier === "client-only",
        )
      );
    })
    .sort();

  const symlinks = entryRoots
    ? entryRoots.flatMap((entryRoot) =>
        sourceSymlinks(resolve(root, entryRoot)),
      )
    : productionSourceSymlinks(root);
  for (const path of symlinks) {
    const modulePath = displayPath(root, path);
    violations.push({
      code: "SOURCE_SYMLINK",
      module: modulePath,
      detail: "production source roots must not contain symlinks",
      chain: [modulePath],
    });
  }

  const queue: QueueEntry[] = entries.map((path) => ({
    path,
    chain: [displayPath(root, path)],
  }));
  const visited = new Set<string>();

  while (queue.length > 0) {
    const current = queue.shift();
    if (!current || visited.has(current.path)) continue;
    visited.add(current.path);

    const modulePath = displayPath(root, current.path);
    const pathCode = forbiddenPathCode(root, current.path);
    if (pathCode) {
      violations.push({
        code: pathCode,
        module: modulePath,
        detail: modulePath,
        chain: current.chain,
      });
      continue;
    }

    const source = readSourceFile(current.path);
    if (sourceParseDiagnostics(source).length > 0) continue;

    for (const detail of forbiddenEnvironmentAccesses(source)) {
      violations.push({
        code: "FORBIDDEN_ENV_ACCESS",
        module: modulePath,
        detail,
        chain: current.chain,
      });
    }
    for (const detail of forbiddenGlobalObjectAliases(source)) {
      violations.push({
        code: "GLOBAL_OBJECT_ALIAS",
        module: modulePath,
        detail,
        chain: current.chain,
      });
    }
    for (const violation of forbiddenDynamicCode(source)) {
      violations.push({
        ...violation,
        module: modulePath,
        chain: current.chain,
      });
    }

    for (const imported of runtimeImports(source)) {
      if (imported.specifier === null) {
        violations.push({
          code: "DYNAMIC_IMPORT_SPECIFIER",
          module: modulePath,
          detail: imported.display,
          chain: current.chain,
        });
        continue;
      }

      const specifier = imported.specifier;
      if (isUnsafeImportSpecifier(specifier)) {
        violations.push({
          code: "UNSAFE_IMPORT_SPECIFIER",
          module: modulePath,
          detail: specifier,
          chain: current.chain,
        });
        continue;
      }
      if (isForbiddenPackage(specifier) || isBuiltinPackage(specifier)) {
        violations.push({
          code: "FORBIDDEN_PACKAGE",
          module: modulePath,
          detail: specifier,
          chain: current.chain,
        });
        continue;
      }
      if (!isLocalSpecifier(specifier)) continue;

      const resolution = resolveLocalImport(root, current.path, specifier);
      const resolutionCode = resolution.escaped
        ? "IMPORT_ESCAPES_ROOT"
        : resolution.ambiguous
          ? "AMBIGUOUS_LOCAL_IMPORT"
          : !resolution.path
            ? "UNRESOLVED_LOCAL_IMPORT"
            : null;
      if (resolutionCode) {
        violations.push({
          code: resolutionCode,
          module: modulePath,
          detail: specifier,
          chain: current.chain,
        });
        continue;
      }
      if (!resolution.path) continue;

      const resolvedModule = displayPath(root, resolution.path);
      const resolvedPathCode = forbiddenPathCode(root, resolution.path);
      if (resolvedPathCode) {
        violations.push({
          code: resolvedPathCode,
          module: resolvedModule,
          detail: resolvedModule,
          chain: [...current.chain, resolvedModule],
        });
        continue;
      }
      if (!resolution.terminal) {
        queue.push({
          path: resolution.path,
          chain: [...current.chain, resolvedModule],
        });
      }
    }
  }

  return violations.sort(compareViolations);
}

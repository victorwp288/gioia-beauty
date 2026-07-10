import { existsSync, lstatSync, readdirSync, realpathSync } from "node:fs";
import { builtinModules } from "node:module";
import { extname, join, relative, resolve, sep } from "node:path";

import ts from "typescript";

import {
  FORBIDDEN_EXACT_PACKAGES,
  FORBIDDEN_PACKAGES,
  SOURCE_EXTENSIONS,
  SOURCE_EXTENSION_SUBSTITUTIONS,
  TERMINAL_EXTENSIONS,
  type BoundaryViolation,
  type BoundaryViolationCode,
  type Resolution,
} from "./contracts.ts";
import {
  displayPath,
  isInside,
  isSourcePath,
  readSourceFile,
  sourcePaths,
} from "./source-files.ts";

const BUILTIN_PACKAGES = new Set(
  builtinModules.flatMap((name) => [name, `node:${name}`]),
);

export function isForbiddenPackage(specifier: string): boolean {
  if (FORBIDDEN_EXACT_PACKAGES.has(specifier)) return true;
  return FORBIDDEN_PACKAGES.some(
    (name) => specifier === name || specifier.startsWith(`${name}/`),
  );
}

export function isBuiltinPackage(specifier: string): boolean {
  if (specifier.startsWith("node:")) return true;
  const packageRoot = specifier.split("/")[0] ?? specifier;
  return BUILTIN_PACKAGES.has(specifier) || BUILTIN_PACKAGES.has(packageRoot);
}

export function isLocalSpecifier(specifier: string): boolean {
  return (
    specifier.startsWith("@/") ||
    specifier.startsWith("./") ||
    specifier.startsWith("../")
  );
}

export function isUnsafeImportSpecifier(specifier: string): boolean {
  return (
    /[\u0000-\u001f\u007f]/.test(specifier) ||
    specifier.startsWith("/") ||
    specifier.includes("\\") ||
    /^[A-Za-z]:\//.test(specifier) ||
    /^(?:blob|data|file|https?):/i.test(specifier) ||
    specifier.includes("?") ||
    (isLocalSpecifier(specifier) && specifier.includes("#"))
  );
}

function pathHasExactCase(root: string, path: string): boolean {
  const parts = relative(root, path).split(sep).filter(Boolean);
  let current = root;
  for (const part of parts) {
    if (!existsSync(current)) return false;
    if (!readdirSync(current).some((name) => name === part)) return false;
    current = join(current, part);
  }
  return true;
}

function resolveCandidate(root: string, candidate: string): Resolution | null {
  if (!existsSync(candidate) || !pathHasExactCase(root, candidate)) return null;

  const stat = lstatSync(candidate);
  const canonical = realpathSync(candidate);
  if (!isInside(root, canonical)) return { escaped: true, terminal: false };
  if (!stat.isFile()) return null;

  const extension = extname(canonical);
  if (isSourcePath(canonical)) {
    return { path: canonical, escaped: false, terminal: false };
  }
  if (TERMINAL_EXTENSIONS.has(extension)) {
    return { path: canonical, escaped: false, terminal: true };
  }
  return null;
}

export function resolveLocalImport(
  root: string,
  from: string,
  specifier: string,
): Resolution {
  const requested = specifier.startsWith("@/")
    ? resolve(root, specifier.slice(2))
    : resolve(from, "..", specifier);
  if (!isInside(root, requested)) return { escaped: true, terminal: false };

  const exact = resolveCandidate(root, requested);
  if (exact) return exact;

  const requestedExtension = extname(requested);
  const candidates = requestedExtension
    ? (SOURCE_EXTENSION_SUBSTITUTIONS[requestedExtension] ?? []).map(
        (extension) =>
          `${requested.slice(0, -requestedExtension.length)}${extension}`,
      )
    : [
        ...SOURCE_EXTENSIONS.map((extension) => `${requested}${extension}`),
        ...[...TERMINAL_EXTENSIONS]
          .sort()
          .map((extension) => `${requested}${extension}`),
        ...SOURCE_EXTENSIONS.map((extension) =>
          join(requested, `index${extension}`),
        ),
      ];

  const resolutions: Resolution[] = [];
  for (const candidate of candidates) {
    const resolution = resolveCandidate(root, candidate);
    if (resolution?.escaped) return resolution;
    if (resolution) resolutions.push(resolution);
  }
  const unique = new Map(
    resolutions.map((resolution) => [resolution.path, resolution]),
  );
  if (unique.size > 1) {
    return { escaped: false, terminal: false, ambiguous: true };
  }
  const only = unique.values().next().value as Resolution | undefined;
  return only ?? { escaped: false, terminal: false };
}

export function forbiddenPathCode(
  root: string,
  path: string,
): BoundaryViolationCode | null {
  const normalized = displayPath(root, path);
  if (normalized === "app/api" || normalized.startsWith("app/api/")) {
    return "CLIENT_REACHES_API_ROUTE";
  }
  if (normalized === "lib/server" || normalized.startsWith("lib/server/")) {
    return "CLIENT_REACHES_SERVER_MODULE";
  }
  return null;
}

function hasLeadingServerOnly(source: ts.SourceFile): boolean {
  const first = source.statements[0];
  return Boolean(
    first &&
    ts.isImportDeclaration(first) &&
    !first.importClause &&
    ts.isStringLiteral(first.moduleSpecifier) &&
    first.moduleSpecifier.text === "server-only",
  );
}

export function databaseBoundaryViolations(
  root: string,
  databaseDirectory: string,
): BoundaryViolation[] {
  return sourcePaths(databaseDirectory)
    .filter((path) => !hasLeadingServerOnly(readSourceFile(path)))
    .map((path) => {
      const modulePath = displayPath(root, path);
      return {
        code: "DATABASE_MODULE_MISSING_SERVER_ONLY" as const,
        module: modulePath,
        detail: 'database modules must begin with import "server-only"',
        chain: [modulePath],
      };
    });
}

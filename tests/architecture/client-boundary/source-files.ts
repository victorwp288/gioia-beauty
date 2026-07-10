import {
  existsSync,
  lstatSync,
  readdirSync,
  readFileSync,
  realpathSync,
} from "node:fs";
import { extname, isAbsolute, join, relative, sep } from "node:path";

import ts from "typescript";

import { EXCLUDED_SOURCE_ROOTS, SOURCE_EXTENSIONS } from "./contracts.ts";

function scriptKind(path: string): ts.ScriptKind {
  if (path.endsWith(".js") || path.endsWith(".mjs") || path.endsWith(".cjs")) {
    return ts.ScriptKind.JS;
  }
  if (path.endsWith(".jsx")) return ts.ScriptKind.JSX;
  if (path.endsWith(".tsx")) return ts.ScriptKind.TSX;
  return ts.ScriptKind.TS;
}

export function readSourceFile(path: string): ts.SourceFile {
  return ts.createSourceFile(
    path,
    readFileSync(path, "utf8"),
    ts.ScriptTarget.Latest,
    true,
    scriptKind(path),
  );
}

export function sourceParseDiagnostics(
  source: ts.SourceFile,
): readonly ts.Diagnostic[] {
  return (
    source as ts.SourceFile & {
      readonly parseDiagnostics: readonly ts.Diagnostic[];
    }
  ).parseDiagnostics;
}

export function isSourcePath(path: string): boolean {
  return (SOURCE_EXTENSIONS as readonly string[]).includes(extname(path));
}

export function isInside(root: string, path: string): boolean {
  const pathFromRoot = relative(root, path);
  return (
    pathFromRoot === "" ||
    (!pathFromRoot.startsWith(`..${sep}`) &&
      pathFromRoot !== ".." &&
      !isAbsolute(pathFromRoot))
  );
}

export function displayPath(root: string, path: string): string {
  return relative(root, path).split(sep).join("/");
}

export function sourcePaths(directory: string): string[] {
  if (!existsSync(directory)) return [];
  return readdirSync(directory, { withFileTypes: true })
    .sort((left, right) => left.name.localeCompare(right.name))
    .flatMap((entry) => {
      const path = join(directory, entry.name);
      if (entry.isSymbolicLink()) return [];
      if (entry.isDirectory()) return sourcePaths(path);
      return entry.isFile() && isSourcePath(path) ? [path] : [];
    });
}

export function productionSourcePaths(root: string): string[] {
  return readdirSync(root, { withFileTypes: true })
    .sort((left, right) => left.name.localeCompare(right.name))
    .flatMap((entry) => {
      if (entry.name.startsWith(".") || EXCLUDED_SOURCE_ROOTS.has(entry.name)) {
        return [];
      }
      const path = join(root, entry.name);
      if (entry.isSymbolicLink()) return [];
      if (entry.isDirectory()) return sourcePaths(path);
      return entry.isFile() && isSourcePath(path) ? [path] : [];
    });
}

export function sourceSymlinks(directory: string): string[] {
  if (!existsSync(directory)) return [];
  return readdirSync(directory, { withFileTypes: true })
    .sort((left, right) => left.name.localeCompare(right.name))
    .flatMap((entry) => {
      const path = join(directory, entry.name);
      if (entry.isSymbolicLink()) {
        const targetIsDirectory =
          existsSync(path) && lstatSync(realpathSync(path)).isDirectory();
        return targetIsDirectory || isSourcePath(path) ? [path] : [];
      }
      if (entry.isDirectory()) return sourceSymlinks(path);
      return [];
    });
}

export function productionSourceSymlinks(root: string): string[] {
  return readdirSync(root, { withFileTypes: true })
    .sort((left, right) => left.name.localeCompare(right.name))
    .flatMap((entry) => {
      if (entry.name.startsWith(".") || EXCLUDED_SOURCE_ROOTS.has(entry.name)) {
        return [];
      }
      const path = join(root, entry.name);
      if (entry.isSymbolicLink()) {
        const targetIsDirectory =
          existsSync(path) && lstatSync(realpathSync(path)).isDirectory();
        return targetIsDirectory || isSourcePath(path) ? [path] : [];
      }
      if (entry.isDirectory()) return sourceSymlinks(path);
      return [];
    });
}

export function hasUseClientDirective(source: ts.SourceFile): boolean {
  for (const statement of source.statements) {
    if (
      !ts.isExpressionStatement(statement) ||
      !ts.isStringLiteral(statement.expression)
    ) {
      return false;
    }
    if (statement.expression.text === "use client") return true;
  }
  return false;
}

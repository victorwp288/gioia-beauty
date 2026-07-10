import { readdirSync, readFileSync, type Dirent } from "node:fs";
import { dirname, join, posix, relative, sep } from "node:path";

import ts from "typescript";
import { describe, expect, it } from "vitest";

const APP_ROOT = join(process.cwd(), "app");
const INVENTORY_PATH = join(process.cwd(), "docs", "API-INVENTORY.md");
const ACTIVE_START = "<!-- api-inventory-active:start -->";
const ACTIVE_END = "<!-- api-inventory-active:end -->";
const HTTP_METHODS = new Set([
  "DELETE",
  "GET",
  "HEAD",
  "OPTIONS",
  "PATCH",
  "POST",
  "PUT",
]);

interface RouteContract {
  readonly method: string;
  readonly path: string;
}

function isRouteModuleName(name: string): boolean {
  return /^route\.(?:js|jsx|ts|tsx)$/.test(name);
}

function routeFiles(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true })
    .sort((left: Dirent, right: Dirent) => left.name.localeCompare(right.name))
    .flatMap((entry: Dirent) => {
      const path = join(directory, entry.name);
      if (entry.isDirectory()) return routeFiles(path);
      return isRouteModuleName(entry.name) ? [path] : [];
    });
}

function isExported(node: ts.Node): boolean {
  return (
    ts.canHaveModifiers(node) &&
    (ts
      .getModifiers(node)
      ?.some((modifier) => modifier.kind === ts.SyntaxKind.ExportKeyword) ??
      false)
  );
}

function scriptKind(path: string): ts.ScriptKind {
  if (path.endsWith(".js")) return ts.ScriptKind.JS;
  if (path.endsWith(".jsx")) return ts.ScriptKind.JSX;
  if (path.endsWith(".tsx")) return ts.ScriptKind.TSX;
  return ts.ScriptKind.TS;
}

function exportedMethods(
  path: string,
  sourceText = readFileSync(path, "utf8"),
): string[] {
  const source = ts.createSourceFile(
    path,
    sourceText,
    ts.ScriptTarget.Latest,
    true,
    scriptKind(path),
  );
  const methods = new Set<string>();

  for (const statement of source.statements) {
    if (
      ts.isFunctionDeclaration(statement) &&
      isExported(statement) &&
      statement.name &&
      HTTP_METHODS.has(statement.name.text)
    ) {
      methods.add(statement.name.text);
    }
    if (ts.isVariableStatement(statement) && isExported(statement)) {
      for (const declaration of statement.declarationList.declarations) {
        if (
          ts.isIdentifier(declaration.name) &&
          HTTP_METHODS.has(declaration.name.text)
        ) {
          methods.add(declaration.name.text);
        }
      }
    }
    if (
      ts.isExportDeclaration(statement) &&
      !statement.isTypeOnly &&
      statement.exportClause &&
      ts.isNamedExports(statement.exportClause)
    ) {
      for (const element of statement.exportClause.elements) {
        if (!element.isTypeOnly && HTTP_METHODS.has(element.name.text)) {
          methods.add(element.name.text);
        }
      }
    }
    if (
      ts.isExportDeclaration(statement) &&
      !statement.isTypeOnly &&
      (!statement.exportClause || !ts.isNamedExports(statement.exportClause))
    ) {
      throw new Error(`API route uses an unsupported wildcard export: ${path}`);
    }
  }
  return [...methods].sort();
}

function routePath(path: string): string | null {
  const segments = relative(APP_ROOT, dirname(path))
    .split(sep)
    .filter(Boolean)
    .filter((segment) => !/^\(.+\)$/.test(segment));
  return segments[0] === "api" ? posix.join("/", ...segments) : null;
}

function currentRoutes(): RouteContract[] {
  return routeFiles(APP_ROOT)
    .flatMap((path) => {
      const urlPath = routePath(path);
      if (urlPath === null) return [];
      const methods = exportedMethods(path);
      if (methods.length === 0) {
        throw new Error(`API route exports no recognized HTTP method: ${path}`);
      }
      return methods.map((method) => ({
        method,
        path: urlPath,
      }));
    })
    .sort(compareRoutes);
}

function compareRoutes(left: RouteContract, right: RouteContract): number {
  return (
    left.path.localeCompare(right.path) ||
    left.method.localeCompare(right.method)
  );
}

function documentedRoutes(document: string): RouteContract[] {
  if (
    document.split(ACTIVE_START).length !== 2 ||
    document.split(ACTIVE_END).length !== 2
  ) {
    throw new Error("Active API inventory requires one marker section");
  }
  const start = document.indexOf(ACTIVE_START);
  const end = document.indexOf(ACTIVE_END);
  if (start < 0 || end <= start) {
    throw new Error("Active API inventory markers are missing");
  }
  const body = document.slice(start + ACTIVE_START.length, end);
  const outside =
    document.slice(0, start) + document.slice(end + ACTIVE_END.length);
  if (/<!--\s*api-route\b/.test(outside)) {
    throw new Error("Active API route marker is outside its section");
  }

  const routes: RouteContract[] = [];
  const marker = /<!-- api-route (\{[^\n]+\}) -->/g;
  for (const match of body.matchAll(marker)) {
    const parsed = JSON.parse(match[1]!) as Record<string, unknown>;
    if (
      Object.keys(parsed).sort().join(",") !== "method,path" ||
      typeof parsed.method !== "string" ||
      !HTTP_METHODS.has(parsed.method) ||
      typeof parsed.path !== "string" ||
      !/^\/api(?:\/[A-Za-z0-9._()[\]-]+)*$/.test(parsed.path)
    ) {
      throw new Error("Active API inventory marker is invalid");
    }
    routes.push({ method: parsed.method, path: parsed.path });
  }
  if (/\bapi-route\b/.test(body.replace(marker, ""))) {
    throw new Error("Active API inventory contains a malformed route marker");
  }
  return routes.sort(compareRoutes);
}

function contractTableRoutes(document: string): RouteContract[] {
  const start = document.indexOf(ACTIVE_END);
  const end = document.indexOf("\n## Known hardening gaps", start);
  if (start < 0 || end <= start) {
    throw new Error("Active API contract tables are missing");
  }
  const routes: RouteContract[] = [];
  const row = /^\|\s*`([A-Z]+) (\/api[^`]*)`\s*\|/gm;
  for (const match of document
    .slice(start + ACTIVE_END.length, end)
    .matchAll(row)) {
    if (!HTTP_METHODS.has(match[1]!)) {
      throw new Error("Active API contract row has an invalid HTTP method");
    }
    routes.push({ method: match[1]!, path: match[2]! });
  }
  return routes.sort(compareRoutes);
}

describe("API inventory coverage", () => {
  it("matches every exported route method exactly once", () => {
    const document = readFileSync(INVENTORY_PATH, "utf8");
    const actual = currentRoutes();
    const documented = documentedRoutes(document);
    const keys = documented.map(({ method, path }) => `${method} ${path}`);

    expect(new Set(keys).size).toBe(keys.length);
    expect(documented).toEqual(actual);
  });

  it("includes a human-readable contract row for every active marker", () => {
    const document = readFileSync(INVENTORY_PATH, "utf8");
    const documented = documentedRoutes(document);
    const tableRows = contractTableRoutes(document);
    const keys = tableRows.map(({ method, path }) => `${method} ${path}`);

    expect(new Set(keys).size).toBe(keys.length);
    expect(tableRows).toEqual(documented);
  });

  it("handles route groups, aliases, JSX, and type-only exports safely", () => {
    expect(
      ["route.js", "route.jsx", "route.ts", "route.tsx"].every(
        isRouteModuleName,
      ),
    ).toBe(true);
    expect(isRouteModuleName("route.mjs")).toBe(false);
    expect(
      routePath(
        join(APP_ROOT, "(server)", "api", "items", "[id]", "route.tsx"),
      ),
    ).toBe("/api/items/[id]");
    expect(
      exportedMethods(
        "synthetic-route.jsx",
        [
          "export const GET = () => null;",
          "export function POST() {}",
          "const update = () => null;",
          "export { update as PATCH };",
          "export type GET = () => void;",
          'export { type DELETE } from "./types";',
        ].join("\n"),
      ),
    ).toEqual(["GET", "PATCH", "POST"]);
  });

  it("fails closed on wildcard runtime exports", () => {
    expect(() =>
      exportedMethods("synthetic-route.ts", 'export * from "./handlers";'),
    ).toThrow("unsupported wildcard export");
  });

  it("fails closed on malformed, misplaced, or duplicate markers", () => {
    const route = '<!-- api-route {"method":"GET","path":"/api/health"} -->';
    for (const document of [
      `${ACTIVE_START}\n<!-- api-route invalid -->\n${ACTIVE_END}`,
      `${route}\n${ACTIVE_START}\n${ACTIVE_END}`,
      `${ACTIVE_START}\n${ACTIVE_END}\n${ACTIVE_START}\n${ACTIVE_END}`,
    ]) {
      expect(() => documentedRoutes(document)).toThrow();
    }
  });
});

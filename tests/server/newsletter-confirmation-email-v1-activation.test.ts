import { existsSync, readFileSync, readdirSync } from "node:fs";
import { extname, join, resolve } from "node:path";

import ts from "typescript";
import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const MODULE_NAME = "newsletterConfirmationEmailV1";
const SOURCE_EXTENSIONS = new Set([
  ".cjs",
  ".cts",
  ".js",
  ".jsx",
  ".mjs",
  ".mts",
  ".ts",
  ".tsx",
]);
const PRODUCTION_DIRECTORIES = [
  "app",
  "components",
  "config",
  "context",
  "data",
  "hooks",
  "lib",
  "pages",
  "src",
];
function sourceFiles(path: string): string[] {
  if (!existsSync(path)) return [];
  return readdirSync(path, { withFileTypes: true }).flatMap((entry) => {
    const entryPath = join(path, entry.name);
    if (entry.isDirectory()) return sourceFiles(entryPath);
    return SOURCE_EXTENSIONS.has(extname(entry.name)) ? [entryPath] : [];
  });
}

function rootSourceFiles(root: string): string[] {
  return readdirSync(root, { withFileTypes: true })
    .filter(
      (entry) => entry.isFile() && SOURCE_EXTENSIONS.has(extname(entry.name)),
    )
    .map((entry) => join(root, entry.name));
}

function propertyPath(node: ts.Expression): string | null {
  if (ts.isIdentifier(node)) return node.text;
  if (ts.isPropertyAccessExpression(node)) {
    const parent = propertyPath(node.expression);
    return parent ? `${parent}.${node.name.text}` : null;
  }
  if (
    ts.isElementAccessExpression(node) &&
    node.argumentExpression &&
    ts.isStringLiteral(node.argumentExpression)
  ) {
    const parent = propertyPath(node.expression);
    return parent ? `${parent}.${node.argumentExpression.text}` : null;
  }
  return null;
}

function importedNames(node: ts.ImportDeclaration): string[] | null {
  if (!ts.isStringLiteral(node.moduleSpecifier)) return null;
  const moduleName = node.moduleSpecifier.text;
  const clause = node.importClause;
  if (moduleName === "server-only") return clause ? null : [];
  if (!clause?.namedBindings || !ts.isNamedImports(clause.namedBindings)) {
    return null;
  }
  const names = clause.namedBindings.elements.map((element) => {
    if (element.propertyName || element.name.text === "default") return null;
    const typeOnly = clause.isTypeOnly || element.isTypeOnly;
    return `${typeOnly ? "type:" : "value:"}${element.name.text}`;
  });
  if (names.some((name) => name === null)) return null;
  return names as string[];
}

function importIsAllowed(node: ts.ImportDeclaration): boolean {
  if (!ts.isStringLiteral(node.moduleSpecifier)) return false;
  const names = importedNames(node);
  if (!names) return false;
  const expected = new Map<string, string[]>([
    ["server-only", []],
    ["zod", ["value:z"]],
    [
      "@/lib/domain/schemas/index.ts",
      [
        "value:IsoInstantSchema",
        "value:NormalizedEmailSchema",
        "value:PositiveVersionSchema",
        "value:UuidSchema",
        "value:isNewsletterActionTokenKeyId",
      ],
    ],
    [
      "@/lib/server/newsletterActionToken.ts",
      ["type:NewsletterActionTokenCodec"],
    ],
    ["./emailProvider.ts", ["type:EmailMessage", "value:EmailMessageSchema"]],
    ["./outboxRendererFault.ts", ["value:OutboxRendererOperationalError"]],
  ]).get(node.moduleSpecifier.text);
  return (
    expected !== undefined &&
    names.length === expected.length &&
    [...names]
      .sort()
      .every((name, index) => name === [...expected].sort()[index])
  );
}

function forbiddenSyntax(source: string): string[] {
  const file = ts.createSourceFile(
    "newsletterConfirmationEmailV1.ts",
    source,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TS,
  );
  const findings: string[] = [];
  const forbiddenAliases = new Set<string>();
  const forbiddenCalls = new Set([
    "Date",
    "Date.now",
    "createEmailOutboxRepository",
    "createEmailProvider",
    "createRuntimeDatabase",
    "crypto.randomUUID",
    "fetch",
    "globalThis.Date.now",
    "globalThis.Date",
    "globalThis.crypto.randomUUID",
    "globalThis.fetch",
    "randomUUID",
    "require",
  ]);

  function collectAliases(node: ts.Node) {
    if (
      ts.isVariableDeclaration(node) &&
      ts.isIdentifier(node.name) &&
      node.initializer
    ) {
      const path = propertyPath(node.initializer);
      if (
        path &&
        (forbiddenCalls.has(path) ||
          path === "process.env" ||
          path.startsWith("process.env.") ||
          path === "console" ||
          path.startsWith("console."))
      ) {
        forbiddenAliases.add(node.name.text);
      }
    }
    ts.forEachChild(node, collectAliases);
  }
  collectAliases(file);

  function visit(node: ts.Node) {
    if (
      ts.isNewExpression(node) &&
      ["Date", "globalThis.Date"].includes(
        propertyPath(node.expression) ?? "",
      ) &&
      (node.arguments?.length ?? 0) === 0
    ) {
      findings.push("unbounded-current-time");
    }
    if (ts.isCallExpression(node)) {
      if (node.expression.kind === ts.SyntaxKind.ImportKeyword) {
        findings.push("dynamic-import");
      }
      const path = propertyPath(node.expression);
      if (path && forbiddenCalls.has(path)) findings.push(path);
      if (
        path &&
        forbiddenAliases.has(path) &&
        ts.isIdentifier(node.expression)
      ) {
        findings.push(`alias:${path}`);
      }
      if (
        ["Date", "globalThis.Date"].includes(path ?? "") &&
        node.arguments.length === 0
      ) {
        findings.push("unbounded-current-time");
      }
    }
    if (
      ts.isPropertyAccessExpression(node) ||
      ts.isElementAccessExpression(node)
    ) {
      const path = propertyPath(node);
      if (path === "process.env" || path?.startsWith("process.env.")) {
        findings.push("process.env");
      }
      if (path === "console" || path?.startsWith("console.")) {
        findings.push("console");
      }
      const root = path?.split(".")[0];
      if (root && forbiddenAliases.has(root)) {
        findings.push(`alias:${root}`);
      }
    }
    if (ts.isImportDeclaration(node) && !importIsAllowed(node)) {
      findings.push(
        `import:${ts.isStringLiteral(node.moduleSpecifier) ? node.moduleSpecifier.text : "unknown"}`,
      );
    }
    ts.forEachChild(node, visit);
  }
  visit(file);
  return findings;
}

describe("inert newsletter confirmation renderer v1", () => {
  it("has no mutable clock, network, environment, database, or logging sink", () => {
    const source = readFileSync(
      resolve(
        process.cwd(),
        "lib/server/email/newsletterConfirmationEmailV1.ts",
      ),
      "utf8",
    );
    expect(forbiddenSyntax(source)).toEqual([]);
  });

  it("detects syntax variants rather than relying on formatting", () => {
    const source = `
      import { fetch as request } from "network";
      const now = new Date ( );
      const Clock = Date;
      Clock();
      Date();
      Date . now ( );
      globalThis.Date.now();
      fetch ("https://example.test");
      globalThis.fetch("https://example.test");
      crypto.randomUUID();
      globalThis.crypto.randomUUID();
      process.env.PRIVATE_VALUE;
      process["env"].OTHER_PRIVATE_VALUE;
      const inheritedEnv = process.env;
      inheritedEnv.PRIVATE_VALUE;
      console.log(now);
      console["log"](now);
      const laterRequest = globalThis["fetch"];
      laterRequest("https://example.test");
      createRuntimeDatabase();
    `;
    expect(forbiddenSyntax(source)).toEqual(
      expect.arrayContaining([
        "unbounded-current-time",
        "Date.now",
        "globalThis.Date.now",
        "fetch",
        "globalThis.fetch",
        "crypto.randomUUID",
        "globalThis.crypto.randomUUID",
        "process.env",
        "console",
        "createRuntimeDatabase",
        "import:network",
        "alias:laterRequest",
        "alias:Clock",
        "alias:inheritedEnv",
      ]),
    );
  });

  it("has no production import or activation path", () => {
    const root = process.cwd();
    const modulePath = resolve(
      root,
      "lib/server/email/newsletterConfirmationEmailV1.ts",
    );
    const productionSources = [
      ...PRODUCTION_DIRECTORIES.flatMap((path) =>
        sourceFiles(resolve(root, path)),
      ),
      ...rootSourceFiles(root),
    ].filter((path) => path !== modulePath);

    expect(
      productionSources.filter((path) =>
        readFileSync(path, "utf8").includes(MODULE_NAME),
      ),
    ).toEqual([]);
    expect(existsSync(resolve(root, "app/newsletter/confirm"))).toBe(false);
    expect(existsSync(resolve(root, "app/api/cron/outbox/route.ts"))).toBe(
      false,
    );
    expect(existsSync(resolve(root, "vercel.json"))).toBe(false);
  });
});

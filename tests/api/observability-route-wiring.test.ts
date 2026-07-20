import { readdirSync, readFileSync, type Dirent } from "node:fs";
import { join, relative, sep } from "node:path";

import ts from "typescript";
import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { OBSERVED_ROUTES } from "@/lib/server/observability/contracts.ts";

const RUNTIME_IMPORT = "@/lib/server/observability/runtime";
const API_ROOT = join(process.cwd(), "app", "api");
const HTTP_METHODS = new Set([
  "DELETE",
  "GET",
  "HEAD",
  "OPTIONS",
  "PATCH",
  "POST",
  "PUT",
]);

const EXPECTED = [
  [
    "app/api/admin/appointments/details/route.ts",
    "POST",
    "admin.appointment.details",
  ],
  [
    "app/api/admin/appointments/reschedule/route.ts",
    "POST",
    "admin.appointment.reschedule",
  ],
  ["app/api/admin/appointments/route.ts", "POST", "admin.appointment.create"],
  [
    "app/api/admin/appointments/status/route.ts",
    "POST",
    "admin.appointment.status",
  ],
  ["app/api/admin/blocks/details/route.ts", "POST", "admin.block.details"],
  [
    "app/api/admin/blocks/reschedule/route.ts",
    "POST",
    "admin.block.reschedule",
  ],
  ["app/api/admin/blocks/route.ts", "POST", "admin.block.create"],
  ["app/api/admin/outbox/retry/route.ts", "POST", "admin.outbox.retry"],
  ["app/api/admin/outbox/route.ts", "GET", "admin.outbox.list"],
  ["app/api/admin/schedule/cancel/route.ts", "POST", "admin.schedule.cancel"],
  ["app/api/admin/schedule/count/route.ts", "GET", "admin.schedule.count"],
  ["app/api/admin/schedule/export/route.ts", "GET", "admin.schedule.export"],
  ["app/api/admin/schedule/route.ts", "GET", "admin.schedule.list"],
  ["app/api/admin/subscribers/route.ts", "GET", "admin.subscriber.list"],
  [
    "app/api/admin/subscribers/unsubscribe/route.ts",
    "POST",
    "admin.subscribers.unsubscribe",
  ],
  ["app/api/admin/vacations/cancel/route.ts", "POST", "admin.vacation.cancel"],
  ["app/api/admin/vacations/route.ts", "GET", "admin.vacation.list"],
  ["app/api/admin/vacations/route.ts", "POST", "admin.vacation.create"],
  ["app/api/admin/vacations/update/route.ts", "POST", "admin.vacation.update"],
  ["app/api/auth/login/route.ts", "POST", "auth.login"],
  ["app/api/auth/logout/route.ts", "POST", "auth.logout"],
  ["app/api/auth/session/route.ts", "GET", "auth.session"],
  ["app/api/availability/route.ts", "GET", "public.availability"],
  ["app/api/bookings/route.ts", "POST", "public.booking"],
  ["app/api/cancel/route.js", "POST", "email.cancellation.legacy"],
  ["app/api/cron/outbox/route.ts", "GET", "cron.outbox"],
  ["app/api/health/route.ts", "GET", "health"],
  ["app/api/maintenance/route.ts", "GET", "public.maintenance.status"],
  ["app/api/newsletter/confirm/route.ts", "POST", "public.newsletter.confirm"],
  [
    "app/api/newsletter/subscribe/route.ts",
    "POST",
    "public.newsletter.subscribe",
  ],
  [
    "app/api/newsletter/unsubscribe/route.ts",
    "POST",
    "public.newsletter.unsubscribe",
  ],
  ["app/api/send/route.js", "POST", "email.booking.legacy"],
  ["app/api/webhooks/resend/route.ts", "POST", "webhook.resend"],
] as const;

interface ObservedExport {
  readonly file: string;
  readonly method: string;
  readonly route: string;
}

function routeFiles(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true })
    .sort((left: Dirent, right: Dirent) => left.name.localeCompare(right.name))
    .flatMap((entry: Dirent) => {
      const path = join(directory, entry.name);
      if (entry.isDirectory()) return routeFiles(path);
      return /^route\.(?:js|ts)$/.test(entry.name) ? [path] : [];
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

function relativePath(path: string): string {
  return relative(process.cwd(), path).split(sep).join("/");
}

function observedExports(path: string): ObservedExport[] {
  const source = ts.createSourceFile(
    path,
    readFileSync(path, "utf8"),
    ts.ScriptTarget.Latest,
    true,
    path.endsWith(".js") ? ts.ScriptKind.JS : ts.ScriptKind.TS,
  );
  const runtimeImports = source.statements.filter(
    (statement): statement is ts.ImportDeclaration =>
      ts.isImportDeclaration(statement) &&
      ts.isStringLiteral(statement.moduleSpecifier) &&
      statement.moduleSpecifier.text === RUNTIME_IMPORT,
  );
  expect(runtimeImports, relativePath(path)).toHaveLength(1);
  const binding = runtimeImports[0]?.importClause?.namedBindings;
  expect(
    binding &&
      ts.isNamedImports(binding) &&
      binding.elements.some(
        (element) =>
          !element.propertyName && element.name.text === "observeServerRoute",
      ),
    relativePath(path),
  ).toBe(true);

  const exports: ObservedExport[] = [];
  for (const statement of source.statements) {
    if (
      ts.isFunctionDeclaration(statement) &&
      isExported(statement) &&
      statement.name &&
      HTTP_METHODS.has(statement.name.text)
    ) {
      throw new Error(
        `${relativePath(path)} ${statement.name.text} bypasses observeServerRoute`,
      );
    }
    if (
      ts.isExportDeclaration(statement) &&
      statement.exportClause &&
      ts.isNamedExports(statement.exportClause)
    ) {
      for (const element of statement.exportClause.elements) {
        const exportedName = element.name.text;
        if (HTTP_METHODS.has(exportedName)) {
          throw new Error(
            `${relativePath(path)} ${exportedName} bypasses observeServerRoute`,
          );
        }
      }
    }
    if (!ts.isVariableStatement(statement) || !isExported(statement)) continue;
    for (const declaration of statement.declarationList.declarations) {
      if (
        !ts.isIdentifier(declaration.name) ||
        !HTTP_METHODS.has(declaration.name.text)
      ) {
        continue;
      }
      const call = declaration.initializer;
      expect(
        call &&
          ts.isCallExpression(call) &&
          ts.isIdentifier(call.expression) &&
          call.expression.text === "observeServerRoute",
        `${relativePath(path)} ${declaration.name.text}`,
      ).toBe(true);
      if (!call || !ts.isCallExpression(call)) continue;
      expect(call.arguments, relativePath(path)).toHaveLength(3);
      const [route, method] = call.arguments;
      expect(ts.isStringLiteral(route!), relativePath(path)).toBe(true);
      expect(ts.isStringLiteral(method!), relativePath(path)).toBe(true);
      if (!ts.isStringLiteral(route!) || !ts.isStringLiteral(method!)) continue;
      expect(method.text, relativePath(path)).toBe(declaration.name.text);
      exports.push({
        file: relativePath(path),
        method: method.text,
        route: route.text,
      });
    }
  }
  return exports;
}

describe("API observability route wiring", () => {
  it("wraps every current route/method with its unique static label", () => {
    const files = routeFiles(API_ROOT);
    const actual = files.flatMap(observedExports);
    const expected = EXPECTED.map(([file, method, route]) => ({
      file,
      method,
      route,
    }));

    expect(files.map(relativePath)).toEqual([
      ...new Set(EXPECTED.map(([file]) => file)),
    ]);
    expect(actual).toEqual(expected);
    expect(new Set(actual.map(({ route }) => route)).size).toBe(actual.length);
    expect(actual.map(({ route }) => route).sort()).toEqual(
      [...OBSERVED_ROUTES].sort(),
    );
  });
});

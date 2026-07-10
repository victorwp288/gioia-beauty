import ts from "typescript";

import type { RuntimeImport } from "./contracts.ts";
import {
  elementAccessName,
  exportClauseIsTypeOnly,
  importClauseIsTypeOnly,
  literalModuleSpecifier,
} from "./ast-helpers.ts";

export function runtimeImports(source: ts.SourceFile): RuntimeImport[] {
  const imports: RuntimeImport[] = [];

  const visit = (node: ts.Node): void => {
    if (ts.isImportDeclaration(node)) {
      if (!importClauseIsTypeOnly(node.importClause)) {
        imports.push({
          specifier: literalModuleSpecifier(node.moduleSpecifier),
          display: node.moduleSpecifier.getText(source),
        });
      }
      return;
    }

    if (ts.isExportDeclaration(node)) {
      if (!exportClauseIsTypeOnly(node) && node.moduleSpecifier) {
        imports.push({
          specifier: literalModuleSpecifier(node.moduleSpecifier),
          display: node.moduleSpecifier.getText(source),
        });
      }
      return;
    }

    if (
      ts.isImportEqualsDeclaration(node) &&
      !node.isTypeOnly &&
      ts.isExternalModuleReference(node.moduleReference)
    ) {
      imports.push({
        specifier: literalModuleSpecifier(node.moduleReference.expression),
        display: node.moduleReference.getText(source),
      });
      return;
    }

    if (ts.isCallExpression(node)) {
      const isDynamicImport =
        node.expression.kind === ts.SyntaxKind.ImportKeyword;
      const isRequire =
        ts.isIdentifier(node.expression) && node.expression.text === "require";
      const isRequireResolve =
        (ts.isPropertyAccessExpression(node.expression) &&
          ts.isIdentifier(node.expression.expression) &&
          node.expression.expression.text === "require" &&
          node.expression.name.text === "resolve") ||
        (ts.isElementAccessExpression(node.expression) &&
          ts.isIdentifier(node.expression.expression) &&
          node.expression.expression.text === "require" &&
          elementAccessName(node.expression) === "resolve");
      const isModuleRequire =
        (ts.isPropertyAccessExpression(node.expression) &&
          ts.isIdentifier(node.expression.expression) &&
          node.expression.expression.text === "module" &&
          node.expression.name.text === "require") ||
        (ts.isElementAccessExpression(node.expression) &&
          ts.isIdentifier(node.expression.expression) &&
          node.expression.expression.text === "module" &&
          elementAccessName(node.expression) === "require");
      if (isDynamicImport || isRequire || isRequireResolve || isModuleRequire) {
        const argument =
          node.arguments.length === 1 ? node.arguments[0] : undefined;
        imports.push({
          specifier: literalModuleSpecifier(argument),
          display: node.getText(source),
        });
        return;
      }
    }

    ts.forEachChild(node, visit);
  };

  ts.forEachChild(source, visit);
  return imports;
}

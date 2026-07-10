import ts from "typescript";

import {
  elementAccessName,
  identifierIsBindingName,
  identifierIsInTypePosition,
  identifierIsNonReferenceName,
} from "./ast-helpers.ts";
import {
  ALLOWED_CLIENT_ENVIRONMENT_KEYS,
  type DynamicCodeViolation,
} from "./contracts.ts";

function isProcessEnv(node: ts.Node): node is ts.PropertyAccessExpression {
  return (
    ts.isPropertyAccessExpression(node) &&
    !node.questionDotToken &&
    ts.isIdentifier(node.expression) &&
    node.expression.text === "process" &&
    node.name.text === "env"
  );
}

function isGlobalProcess(
  node: ts.Node,
): node is ts.PropertyAccessExpression | ts.ElementAccessExpression {
  if (
    !ts.isPropertyAccessExpression(node) &&
    !ts.isElementAccessExpression(node)
  ) {
    return false;
  }
  if (
    !ts.isIdentifier(node.expression) ||
    !["globalThis", "self", "window"].includes(node.expression.text)
  ) {
    return false;
  }
  return ts.isPropertyAccessExpression(node)
    ? node.name.text === "process"
    : elementAccessName(node) === "process";
}

export function forbiddenEnvironmentAccesses(source: ts.SourceFile): string[] {
  const accesses: string[] = [];

  const visit = (node: ts.Node): void => {
    if (isProcessEnv(node)) {
      const parent = node.parent;
      const isAllowedRead =
        ts.isPropertyAccessExpression(parent) &&
        !parent.questionDotToken &&
        parent.expression === node &&
        ALLOWED_CLIENT_ENVIRONMENT_KEYS.has(parent.name.text) &&
        !(
          ts.isBinaryExpression(parent.parent) &&
          parent.parent.left === parent &&
          parent.parent.operatorToken.kind >= ts.SyntaxKind.FirstAssignment &&
          parent.parent.operatorToken.kind <= ts.SyntaxKind.LastAssignment
        ) &&
        !(
          (ts.isPrefixUnaryExpression(parent.parent) ||
            ts.isPostfixUnaryExpression(parent.parent)) &&
          parent.parent.operand === parent
        ) &&
        !(
          ts.isDeleteExpression(parent.parent) &&
          parent.parent.expression === parent
        );
      if (isAllowedRead) return;
      accesses.push(parent?.getText(source) ?? node.getText(source));
      return;
    }

    if (
      ts.isElementAccessExpression(node) &&
      ts.isIdentifier(node.expression) &&
      node.expression.text === "process"
    ) {
      accesses.push(node.getText(source));
      return;
    }

    if (isGlobalProcess(node)) {
      accesses.push(node.getText(source));
      return;
    }

    if (ts.isIdentifier(node) && node.text === "process") {
      const parent = node.parent;
      const isDirectEnvironmentObject =
        isProcessEnv(parent) && parent.expression === node;
      if (
        identifierIsBindingName(node) ||
        (!isDirectEnvironmentObject && !identifierIsNonReferenceName(node))
      ) {
        accesses.push(node.getText(source));
        return;
      }
    }

    if (
      ts.isMetaProperty(node) &&
      node.keywordToken === ts.SyntaxKind.ImportKeyword &&
      node.name.text === "meta"
    ) {
      const parent = node.parent;
      const isEnvironmentAccess =
        (ts.isPropertyAccessExpression(parent) &&
          parent.expression === node &&
          parent.name.text === "env") ||
        (ts.isElementAccessExpression(parent) &&
          parent.expression === node &&
          elementAccessName(parent) === "env");
      if (isEnvironmentAccess) {
        accesses.push(parent.getText(source));
        return;
      }
    }

    ts.forEachChild(node, visit);
  };

  ts.forEachChild(source, visit);
  return accesses;
}

export function forbiddenGlobalObjectAliases(source: ts.SourceFile): string[] {
  const aliases: string[] = [];

  const visit = (node: ts.Node): void => {
    if (
      ts.isIdentifier(node) &&
      ["globalThis", "self", "window"].includes(node.text)
    ) {
      const parent = node.parent;
      const isDirectMemberObject =
        (ts.isPropertyAccessExpression(parent) ||
          ts.isElementAccessExpression(parent)) &&
        parent.expression === node;
      const isTypeofProbe =
        ts.isTypeOfExpression(parent) && parent.expression === node;
      if (
        identifierIsBindingName(node) ||
        (!identifierIsNonReferenceName(node) &&
          !isDirectMemberObject &&
          !isTypeofProbe)
      ) {
        aliases.push(node.getText(source));
        return;
      }
    }
    ts.forEachChild(node, visit);
  };

  ts.forEachChild(source, visit);
  return aliases;
}

export function forbiddenDynamicCode(
  source: ts.SourceFile,
): DynamicCodeViolation[] {
  const violations: DynamicCodeViolation[] = [];

  const visit = (node: ts.Node): void => {
    if (
      (ts.isPropertyAccessExpression(node) ||
        ts.isElementAccessExpression(node)) &&
      ts.isIdentifier(node.expression) &&
      ["globalThis", "self", "window"].includes(node.expression.text)
    ) {
      const memberName = ts.isPropertyAccessExpression(node)
        ? node.name.text
        : (elementAccessName(node) ?? "");
      const code = ["Function", "createRequire", "eval"].includes(memberName)
        ? "DYNAMIC_CODE_EXECUTION"
        : ["module", "require"].includes(memberName)
          ? "DYNAMIC_MODULE_LOADER"
          : null;
      if (code) {
        violations.push({ code, detail: node.getText(source) });
        return;
      }
    }

    if (
      ts.isIdentifier(node) &&
      ["Function", "createRequire", "eval"].includes(node.text) &&
      !identifierIsInTypePosition(node) &&
      !(
        node.text === "Function" &&
        ts.isBinaryExpression(node.parent) &&
        node.parent.right === node &&
        node.parent.operatorToken.kind === ts.SyntaxKind.InstanceOfKeyword
      ) &&
      (identifierIsBindingName(node) || !identifierIsNonReferenceName(node))
    ) {
      violations.push({
        code: "DYNAMIC_CODE_EXECUTION",
        detail: node.getText(source),
      });
      return;
    }

    if (ts.isIdentifier(node) && node.text === "require") {
      const parent = node.parent;
      const isDirectCall =
        ts.isCallExpression(parent) && parent.expression === node;
      const isCalledResolve =
        (ts.isPropertyAccessExpression(parent) ||
          ts.isElementAccessExpression(parent)) &&
        parent.expression === node &&
        (ts.isPropertyAccessExpression(parent)
          ? parent.name.text === "resolve"
          : elementAccessName(parent) === "resolve") &&
        ts.isCallExpression(parent.parent) &&
        parent.parent.expression === parent;
      if (
        !identifierIsInTypePosition(node) &&
        (identifierIsBindingName(node) ||
          (!isDirectCall &&
            !isCalledResolve &&
            !identifierIsNonReferenceName(node)))
      ) {
        violations.push({
          code: "DYNAMIC_MODULE_LOADER",
          detail: node.getText(source),
        });
        return;
      }
    }

    if (ts.isIdentifier(node) && node.text === "module") {
      const parent = node.parent;
      const isCalledRequire =
        (ts.isPropertyAccessExpression(parent) ||
          ts.isElementAccessExpression(parent)) &&
        parent.expression === node &&
        (ts.isPropertyAccessExpression(parent)
          ? parent.name.text === "require"
          : elementAccessName(parent) === "require") &&
        ts.isCallExpression(parent.parent) &&
        parent.parent.expression === parent;
      if (
        !identifierIsInTypePosition(node) &&
        (identifierIsBindingName(node) ||
          (!isCalledRequire && !identifierIsNonReferenceName(node)))
      ) {
        violations.push({
          code: "DYNAMIC_MODULE_LOADER",
          detail: node.getText(source),
        });
        return;
      }
    }

    ts.forEachChild(node, visit);
  };

  ts.forEachChild(source, visit);
  return violations;
}

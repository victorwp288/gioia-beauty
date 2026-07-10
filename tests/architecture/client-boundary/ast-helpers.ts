import ts from "typescript";

export function literalModuleSpecifier(
  node: ts.Expression | undefined,
): string | null {
  if (!node) return null;
  if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) {
    return node.text;
  }
  return null;
}

export function elementAccessName(
  node: ts.ElementAccessExpression,
): string | null {
  const argument = node.argumentExpression;
  if (
    ts.isStringLiteral(argument) ||
    ts.isNoSubstitutionTemplateLiteral(argument)
  ) {
    return argument.text;
  }
  return null;
}

export function identifierIsNonReferenceName(node: ts.Identifier): boolean {
  const parent = node.parent;
  if (ts.isPropertyAccessExpression(parent) && parent.name === node)
    return true;
  if (
    (ts.isPropertyAssignment(parent) ||
      ts.isMethodDeclaration(parent) ||
      ts.isGetAccessorDeclaration(parent) ||
      ts.isSetAccessorDeclaration(parent) ||
      ts.isPropertyDeclaration(parent) ||
      ts.isPropertySignature(parent) ||
      ts.isMethodSignature(parent) ||
      ts.isEnumMember(parent)) &&
    parent.name === node
  ) {
    return true;
  }
  if (ts.isBindingElement(parent) && parent.propertyName === node) return true;
  if (ts.isImportSpecifier(parent) && parent.propertyName === node) return true;
  if (ts.isExportSpecifier(parent) && parent.propertyName === node) return true;
  if (ts.isJsxAttribute(parent) && parent.name === node) return true;
  if (ts.isLabeledStatement(parent) && parent.label === node) return true;
  if (
    (ts.isBreakStatement(parent) || ts.isContinueStatement(parent)) &&
    parent.label === node
  ) {
    return true;
  }
  return false;
}

export function identifierIsBindingName(node: ts.Identifier): boolean {
  const parent = node.parent;
  return Boolean(
    (ts.isVariableDeclaration(parent) ||
      ts.isParameter(parent) ||
      ts.isBindingElement(parent) ||
      ts.isFunctionDeclaration(parent) ||
      ts.isFunctionExpression(parent) ||
      ts.isClassDeclaration(parent) ||
      ts.isClassExpression(parent) ||
      ts.isImportClause(parent) ||
      ts.isImportSpecifier(parent) ||
      ts.isNamespaceImport(parent) ||
      ts.isImportEqualsDeclaration(parent)) &&
    parent.name === node,
  );
}

export function identifierIsInTypePosition(node: ts.Identifier): boolean {
  let current: ts.Node = node;
  while (current.parent && !ts.isStatement(current.parent)) {
    if (ts.isTypeNode(current.parent)) return true;
    current = current.parent;
  }
  return false;
}

export function importClauseIsTypeOnly(
  clause: ts.ImportClause | undefined,
): boolean {
  if (!clause) return false;
  if (clause.isTypeOnly) return true;
  if (clause.name || !clause.namedBindings) return false;
  return (
    ts.isNamedImports(clause.namedBindings) &&
    clause.namedBindings.elements.length > 0 &&
    clause.namedBindings.elements.every((element) => element.isTypeOnly)
  );
}

export function exportClauseIsTypeOnly(
  statement: ts.ExportDeclaration,
): boolean {
  if (statement.isTypeOnly) return true;
  return Boolean(
    statement.exportClause &&
    ts.isNamedExports(statement.exportClause) &&
    statement.exportClause.elements.length > 0 &&
    statement.exportClause.elements.every((element) => element.isTypeOnly),
  );
}

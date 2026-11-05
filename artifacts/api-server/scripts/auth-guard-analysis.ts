import ts from "typescript";

// Only statically known, non-global prefixes are safe. Requiring a fixed first
// segment also rejects "/" and catch-all patterns such as "/{*path}".
function isSafePrefix(node: ts.Expression): boolean {
  return (
    (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) &&
    /^\/[a-zA-Z0-9_-]+(?:\/|$)/.test(node.text)
  );
}

function isScopedPath(node: ts.Expression | undefined): boolean {
  if (!node) return false;
  if (isSafePrefix(node)) return true;
  return ts.isArrayLiteralExpression(node) &&
    node.elements.length > 0 &&
    node.elements.every(isSafePrefix);
}

export function findUnscopedUses(src: string): { line: number; text: string }[] {
  const source = ts.createSourceFile("router.ts", src, ts.ScriptTarget.Latest, true);
  const hits: { line: number; text: string }[] = [];
  function visit(node: ts.Node) {
    if (
      ts.isCallExpression(node) &&
      ts.isPropertyAccessExpression(node.expression) &&
      node.expression.name.text === "use" &&
      ts.isIdentifier(node.expression.expression) &&
      /^(?:router|[\w$]+Router)$/i.test(node.expression.expression.text) &&
      !isScopedPath(node.arguments[0])
    ) {
      hits.push({
        line: source.getLineAndCharacterOfPosition(node.getStart(source)).line + 1,
        text: node.getText(source).split("\n")[0].trim(),
      });
    }
    ts.forEachChild(node, visit);
  }
  visit(source);
  return hits;
}

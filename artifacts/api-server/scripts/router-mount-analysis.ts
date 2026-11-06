import ts from "typescript";
import { existsSync } from "node:fs";
import { isAbsolute, relative, resolve } from "node:path";

/**
 * Deliberately small static contract: direct, unconditional router.use calls
 * with imported handlers (and optional literal paths). Dynamic composition is
 * an error, never a reason to leave a router out of the security check.
 */
export function analyzeRouterMounts(src: string, routesDir: string): {
  mountOrder: string[];
  errors: string[];
} {
  const source = ts.createSourceFile("index.ts", src, ts.ScriptTarget.Latest, true);
  const mountOrder: string[] = [];
  const errors: string[] = [];
  const imports = new Map<string, string>();
  const report = (node: ts.Node, message: string) => {
    const line = source.getLineAndCharacterOfPosition(node.getStart(source)).line + 1;
    errors.push(`ERROR: routes/index.ts:${line} — ${message}`);
  };

  // The parser recovers from malformed syntax; do not accept its partial tree.
  const diagnostics = (source as ts.SourceFile & {
    parseDiagnostics: readonly ts.Diagnostic[];
  }).parseDiagnostics;
  for (const diagnostic of diagnostics) {
    errors.push(`ERROR: routes/index.ts — sintaxis inválida: ${
      ts.flattenDiagnosticMessageText(diagnostic.messageText, "\n")
    }`);
  }

  for (const statement of source.statements) {
    if (!ts.isImportDeclaration(statement) ||
        !ts.isStringLiteral(statement.moduleSpecifier)) continue;
    const clause = statement.importClause;
    if (!clause || clause.isTypeOnly) continue;
    const specifier = statement.moduleSpecifier.text;
    if (clause.name) imports.set(clause.name.text, specifier);
    if (clause.namedBindings && ts.isNamedImports(clause.namedBindings)) {
      for (const element of clause.namedBindings.elements) {
        if (!element.isTypeOnly) imports.set(element.name.text, specifier);
      }
    }
  }

  function resolveImport(node: ts.Expression) {
    const specifier = ts.isIdentifier(node) ? imports.get(node.text) : undefined;
    if (!specifier?.startsWith("./")) {
      report(node, `montaje "${node.getText(source)}" no resoluble como import local de router.`);
      return;
    }
    const base = resolve(routesDir, specifier.replace(/\.js$/, ".ts"));
    const candidates = [base.endsWith(".ts") ? base : `${base}.ts`, resolve(base, "index.ts")];
    const file = candidates.find(existsSync);
    const path = file && relative(routesDir, file);
    if (!path || isAbsolute(path) || path.startsWith("..")) {
      report(node, `no se pudo resolver el archivo del import "${specifier}".`);
      return;
    }
    mountOrder.push(path);
  }

  function visit(node: ts.Node) {
    if (ts.isCallExpression(node)) {
      const callee = node.expression;
      let containsMountReference = false;
      function scanCallee(part: ts.Node) {
        if ((ts.isPropertyAccessExpression(part) && part.name.text === "use") ||
            ts.isElementAccessExpression(part)) containsMountReference = true;
        ts.forEachChild(part, scanCallee);
      }
      scanCallee(callee);
      const receiver = ts.isPropertyAccessExpression(callee) ||
        ts.isElementAccessExpression(callee) ? callee.expression : undefined;
      // Include chained/computed calls rooted at router so they cannot silently
      // disappear when changing the spelling of a direct mount.
      let root = receiver;
      while (root && (ts.isCallExpression(root) ||
        ts.isPropertyAccessExpression(root) || ts.isElementAccessExpression(root))) {
        root = root.expression;
      }
      const isMountCall = containsMountReference ||
        (ts.isPropertyAccessExpression(callee) && callee.name.text === "use") ||
        ts.isElementAccessExpression(callee) ||
        (root && ts.isIdentifier(root) && root.text === "router");
      if (isMountCall) {
        if (!ts.isPropertyAccessExpression(callee) || callee.name.text !== "use" ||
            !receiver || !ts.isIdentifier(receiver) || receiver.text !== "router" ||
            !ts.isExpressionStatement(node.parent) || node.parent.parent !== source ||
            node.questionDotToken || callee.questionDotToken) {
          report(node, `montaje no resoluble; usa router.use(...) directamente al nivel superior.`);
          return;
        }
        let args = [...node.arguments];
        const first = args[0];
        const literal = (n: ts.Node) =>
          ts.isStringLiteral(n) || ts.isNoSubstitutionTemplateLiteral(n);
        if (first && (literal(first) || (ts.isArrayLiteralExpression(first) &&
            first.elements.length > 0 && first.elements.every(literal)))) args = args.slice(1);
        if (!args.length) report(node, "montaje sin router resoluble.");
        for (const arg of args) resolveImport(arg);
        return;
      }
    }
    ts.forEachChild(node, visit);
  }
  visit(source);
  if (!mountOrder.length) errors.push("ERROR: no se detectó ningún montaje en routes/index.ts.");
  return { mountOrder, errors };
}

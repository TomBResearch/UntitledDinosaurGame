/**
 * UDG-SPIKE-001 slice 30r7 — DETERMINISTIC cross-context closure guard (the EE session-3 lesson).
 *
 * `page.evaluate(fn)` SERIALIZES `fn` to the browser: every identifier the callback references
 * must exist in the browser or be passed through the args channel. A reference to a module-level
 * Node-side binding is a latent ReferenceError that fires ONLY when the executed JS path touches
 * it — the EE capture proved it on the nonempty recovery/late-event path (`sanitizeGa11Detail`
 * inside the old epoch-evidence evaluate: sessions without recovery events passed, the one
 * session WITH events died). A runtime test can miss such a path; the compiler cannot: this test
 * parses the real e2e spec with the PINNED TypeScript compiler and reports EVERY value-position
 * reference from inside an inline evaluate callback to a module-scope binding of the same file,
 * plus references to Node-only globals (Buffer/process/require/__dirname) that never exist in
 * Chromium. Zero violations is the rule; the check is pure-static (no browser, no network).
 */

import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import ts from 'typescript';
import { describe, expect, it } from 'vitest';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const SPEC = join(ROOT, 'tests', 'e2e', 'netcode.spec.ts');

const NODE_ONLY_GLOBALS = new Set(['Buffer', 'process', 'require', '__dirname', '__filename', 'global']);

/** True when the node sits inside a TYPE position of an ancestor (types are erased — they never
 * cross the serialization boundary, so `as PredSeatWindow` casts are not violations). */
const inTypePosition = (node: ts.Node, stop: ts.Node): boolean => {
  let cur: ts.Node | undefined = node.parent;
  while (cur !== undefined && cur !== stop) {
    if (ts.isTypeNode(cur) || ts.isTypeElement(cur) || ts.isTypeParameterDeclaration(cur)) return true;
    cur = cur.parent;
  }
  return false;
};

const collectModuleScopeNames = (sf: ts.SourceFile): Set<string> => {
  const names = new Set<string>();
  for (const stmt of sf.statements) {
    if (ts.isVariableStatement(stmt)) {
      for (const d of stmt.declarationList.declarations) {
        if (ts.isIdentifier(d.name)) names.add(d.name.text);
      }
    } else if (ts.isFunctionDeclaration(stmt) && stmt.name !== undefined) {
      names.add(stmt.name.text);
    } else if (ts.isClassDeclaration(stmt) && stmt.name !== undefined) {
      names.add(stmt.name.text);
    } else if (ts.isImportDeclaration(stmt) && stmt.importClause !== undefined) {
      const clause = stmt.importClause;
      if (clause.name !== undefined && !clause.isTypeOnly) names.add(clause.name.text);
      for (const el of clause.namedBindings !== undefined && ts.isNamedImports(clause.namedBindings) ? clause.namedBindings.elements : []) {
        // VALUE imports cross the serialization boundary as missing identifiers in the browser —
        // the EE bug (sanitizeGa11Detail) was exactly an IMPORTED Node helper; type-only imports
        // are erased and stay legal inside evaluate.
        if (!el.isTypeOnly && !clause.isTypeOnly) names.add(el.name.text);
      }
    } else if (ts.isTypeAliasDeclaration(stmt) || ts.isInterfaceDeclaration(stmt) || ts.isEnumDeclaration(stmt)) {
      names.add(stmt.name.text);
    }
  }
  return names;
};

const findEvaluateCallbacks = (sf: ts.SourceFile): { callback: ts.FunctionLikeDeclaration; line: number }[] => {
  const found: { callback: ts.FunctionLikeDeclaration; line: number }[] = [];
  const walk = (node: ts.Node): void => {
    if (ts.isCallExpression(node)
      && ts.isPropertyAccessExpression(node.expression)
      && node.expression.name.text === 'evaluate') {
      for (const arg of node.arguments) {
        if (ts.isArrowFunction(arg) || ts.isFunctionExpression(arg)) {
          found.push({ callback: arg, line: sf.getLineAndCharacterOfPosition(arg.getStart(sf)).line + 1 });
        }
      }
    }
    ts.forEachChild(node, walk);
  };
  walk(sf);
  return found;
};

describe('slice-30r7 cross-context closure guard (serialized page.evaluate must be self-contained)', () => {
  it('no inline page.evaluate callback references a module-scope binding of the spec or a Node-only global (value positions; type casts are erased)', () => {
    const configPath = join(ROOT, 'tsconfig.e2e.json');
    const configJson = ts.readConfigFile(configPath, (p) => readFileSync(p, 'utf8'));
    expect(configJson.error).toBeUndefined();
    const parsed = ts.parseJsonConfigFileContent(configJson.config, ts.sys, ROOT);
    const program = ts.createProgram({ rootNames: [SPEC], options: parsed.options });
    const checker = program.getTypeChecker();
    const sf = program.getSourceFile(SPEC);
    if (sf === undefined) { throw new Error(`closure guard: cannot load ${SPEC} — the guard itself is broken`); }
    expect(sf, 'the e2e spec is part of the pinned e2e program').toBeDefined();
    const moduleNames = collectModuleScopeNames(sf!);

    const violations: string[] = [];
    for (const { callback, line } of findEvaluateCallbacks(sf!)) {
      const innerNames = new Set<string>();
      const collectInner = (node: ts.Node): void => {
        if (ts.isParameter(node) && ts.isIdentifier(node.name)) innerNames.add(node.name.text);
        else if ((ts.isVariableDeclaration(node) || ts.isFunctionDeclaration(node) || ts.isClassDeclaration(node)) && node.name !== undefined && ts.isIdentifier(node.name)) innerNames.add(node.name.text);
        ts.forEachChild(node, collectInner);
      };
      collectInner(callback);

      const scan = (node: ts.Node): void => {
        if (ts.isIdentifier(node)) {
          const parent = node.parent;
          const isValuePosition = !(parent !== undefined && ts.isPropertyAccessExpression(parent) && parent.name === node && !parent.questionDotToken)
            && !(parent !== undefined && (ts.isPropertyAssignment(parent) || ts.isShorthandPropertyAssignment(parent)) && parent.name === node)
            && !inTypePosition(node, callback);
          if (isValuePosition && !innerNames.has(node.text)) {
            if (NODE_ONLY_GLOBALS.has(node.text) && node.text !== 'global') {
              // globalThis is legitimate; the bare 'global' identifier is not (never exists in Chromium either).
              violations.push(`line ${line}: Node-only global '${node.text}' referenced inside evaluate`);
            }
            const symbol = checker.getSymbolAtLocation(node);
            const resolved = symbol !== undefined && symbol.flags & ts.SymbolFlags.Alias ? checker.getAliasedSymbol(symbol) : symbol;
            if (resolved !== undefined) {
              const decl = resolved.valueDeclaration ?? resolved.declarations?.[0];
              const isSpecModuleScope = decl !== undefined && decl.getSourceFile() === sf && moduleNames.has(node.text);
              const isNodeSideValueImport = moduleNames.has(node.text) && decl !== undefined && decl.getSourceFile() !== sf
                && sf.statements.some((st) => ts.isImportDeclaration(st) && st.importClause !== undefined
                  && (st.importClause.name?.text === node.text
                    || (st.importClause.namedBindings !== undefined && ts.isNamedImports(st.importClause.namedBindings)
                      && st.importClause.namedBindings.elements.some((el) => el.name.text === node.text && !el.isTypeOnly && !(st.importClause?.isTypeOnly ?? false)))));
              if (isSpecModuleScope || isNodeSideValueImport) {
                violations.push(`line ${line}: evaluate callback references ${isNodeSideValueImport ? 'Node-side import' : 'module-scope binding'} '${node.text}' (serialized to the browser — ReferenceError when the path runs)`);
              }
            }
          }
        }
        ts.forEachChild(node, scan);
      };
      scan(callback);
    }

    expect(violations, `cross-context closure violations in page.evaluate callbacks:\n${violations.join('\n')}`).toEqual([]);
  }, 120_000);
});

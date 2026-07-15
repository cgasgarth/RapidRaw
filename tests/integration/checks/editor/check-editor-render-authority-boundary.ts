#!/usr/bin/env bun

import { readFileSync } from 'node:fs';
import { relative } from 'node:path';
import ts from '@typescript/typescript6';
import { getExtension, walkRepoFiles } from '../../../../scripts/lib/ci/repo-files';

const authorityKeys = new Set([
  'adjustments',
  'adjustmentRevision',
  'adjustmentSnapshot',
  'editDocumentHistory',
  'editDocumentV2',
  'history',
  'historyCheckpoints',
  'historyIndex',
]);
const directSetStateUiKeys = new Set([
  'activeMaskContainerId',
  'activeMaskId',
  'finalPreviewUrl',
  'uncroppedAdjustedPreviewUrl',
]);

interface BoundaryViolation {
  label: string;
  line: number;
}

type GuardedEditorMethod = 'hydrateEditorRenderAuthority' | 'setEditor' | 'setState';

const unwrap = (expression: ts.Expression): ts.Expression => {
  let current = expression;
  while (
    ts.isParenthesizedExpression(current) ||
    ts.isAsExpression(current) ||
    ts.isSatisfiesExpression(current) ||
    ts.isTypeAssertionExpression(current)
  ) {
    current = current.expression;
  }
  return current;
};

const objectUpdate = (expression: ts.Expression): ts.ObjectLiteralExpression | null => {
  const current = unwrap(expression);
  if (ts.isObjectLiteralExpression(current)) return current;
  if (ts.isArrowFunction(current) && !ts.isBlock(current.body)) {
    const body = unwrap(current.body);
    if (ts.isObjectLiteralExpression(body)) return body;
  }
  return null;
};

const objectUpdates = (expression: ts.Expression): ts.ObjectLiteralExpression[] => {
  const current = unwrap(expression);
  if (!ts.isArrowFunction(current) || !ts.isBlock(current.body)) {
    const update = objectUpdate(current);
    return update === null ? [] : [update];
  }
  const updates: ts.ObjectLiteralExpression[] = [];
  const visit = (node: ts.Node): void => {
    if (ts.isReturnStatement(node) && node.expression !== undefined) {
      const update = objectUpdate(node.expression);
      if (update !== null) updates.push(update);
      return;
    }
    ts.forEachChild(node, visit);
  };
  visit(current.body);
  return updates;
};

const propertyName = (property: ts.ObjectLiteralElementLike): string | null => {
  if (!('name' in property) || property.name === undefined) return null;
  return ts.isIdentifier(property.name) || ts.isStringLiteral(property.name) ? property.name.text : null;
};

export const findEditorRenderAuthorityViolations = (filePath: string, contents: string): BoundaryViolation[] => {
  const sourceFile = ts.createSourceFile(
    filePath,
    contents,
    ts.ScriptTarget.Latest,
    true,
    filePath.endsWith('.tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
  );
  const violations: BoundaryViolation[] = [];
  const methodAliases = new Map<string, GuardedEditorMethod>();
  const editorStoreAliases = new Set(['useEditorStore']);
  const report = (node: ts.Node, label: string) => {
    violations.push({
      label,
      line: sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile)).line + 1,
    });
  };
  const isEditorStoreExpression = (expression: ts.Expression): boolean => {
    const current = unwrap(expression);
    return ts.isIdentifier(current) && editorStoreAliases.has(current.text);
  };
  const resolveGuardedMethod = (expression: ts.Expression): GuardedEditorMethod | null => {
    const current = unwrap(expression);
    if (ts.isIdentifier(current)) {
      return (
        methodAliases.get(current.text) ??
        (current.text === 'setEditor' || current.text === 'hydrateEditorRenderAuthority' ? current.text : null)
      );
    }
    if (!ts.isPropertyAccessExpression(current)) return null;
    if (current.name.text === 'setEditor' || current.name.text === 'hydrateEditorRenderAuthority') {
      return current.name.text;
    }
    return current.name.text === 'setState' && isEditorStoreExpression(current.expression) ? 'setState' : null;
  };
  const bindIdentifier = (name: ts.Identifier, method: GuardedEditorMethod | null): boolean => {
    if (method === null || methodAliases.get(name.text) === method) return false;
    methodAliases.set(name.text, method);
    return true;
  };
  const collectAliases = (): void => {
    let changed = true;
    while (changed) {
      changed = false;
      const collect = (node: ts.Node): void => {
        if (ts.isVariableDeclaration(node) && node.initializer !== undefined) {
          const initializer = unwrap(node.initializer);
          if (ts.isIdentifier(node.name)) {
            if (isEditorStoreExpression(initializer) && !editorStoreAliases.has(node.name.text)) {
              editorStoreAliases.add(node.name.text);
              changed = true;
            }
            changed = bindIdentifier(node.name, resolveGuardedMethod(initializer)) || changed;
          } else if (ts.isObjectBindingPattern(node.name)) {
            const fromEditorStore = isEditorStoreExpression(initializer);
            for (const element of node.name.elements) {
              if (!ts.isIdentifier(element.name)) continue;
              const property = element.propertyName ?? element.name;
              const propertyText =
                ts.isIdentifier(property) || ts.isStringLiteral(property)
                  ? property.text
                  : property.getText(sourceFile);
              const method =
                propertyText === 'setEditor' || propertyText === 'hydrateEditorRenderAuthority'
                  ? propertyText
                  : propertyText === 'setState' && fromEditorStore
                    ? 'setState'
                    : null;
              changed = bindIdentifier(element.name, method) || changed;
            }
          }
        } else if (
          ts.isBinaryExpression(node) &&
          node.operatorToken.kind === ts.SyntaxKind.EqualsToken &&
          ts.isIdentifier(node.left)
        ) {
          changed = bindIdentifier(node.left, resolveGuardedMethod(node.right)) || changed;
        }
        ts.forEachChild(node, collect);
      };
      collect(sourceFile);
    }
  };
  collectAliases();
  const visit = (node: ts.Node): void => {
    if (!ts.isCallExpression(node)) {
      ts.forEachChild(node, visit);
      return;
    }
    const method = resolveGuardedMethod(node.expression);
    const update = node.arguments[0] === undefined ? null : objectUpdate(node.arguments[0]);
    const isGuardedInternalSetStateCall =
      filePath.endsWith('/src/store/useEditorStore.ts') &&
      ts.isIdentifier(node.expression) &&
      node.expression.text === 'directEditorStoreSetState';
    if (method === 'setEditor') {
      const forbidden = objectUpdates(node.arguments[0] ?? ts.factory.createObjectLiteralExpression())
        .flatMap(({ properties }) => properties.map(propertyName))
        .filter((name) => name !== null && authorityKeys.has(name));
      if (forbidden.length > 0) report(node, `setEditor writes ${forbidden.join(',')}`);
    }
    if (method === 'hydrateEditorRenderAuthority') {
      report(node, 'production hydration bypasses EditTransaction');
    }
    if (method === 'setState' && !isGuardedInternalSetStateCall) {
      if (update === null) {
        report(node, 'dynamic useEditorStore.setState update');
      } else {
        const names = update.properties.map(propertyName);
        const forbidden = names.filter((name) => name !== null && authorityKeys.has(name));
        if (forbidden.length > 0) report(node, `useEditorStore.setState writes ${forbidden.join(',')}`);
        else if (names.some((name) => name === null || !directSetStateUiKeys.has(name))) {
          report(node, 'unapproved direct useEditorStore.setState update');
        }
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(sourceFile);
  return violations;
};

const selfTest = () => {
  const cases = [
    ['setEditor authority', 'store.setEditor({ adjustments });', ['setEditor writes adjustments']],
    ['identifier setEditor', 'setEditor({ historyIndex: 2 });', ['setEditor writes historyIndex']],
    [
      'block setEditor',
      'setEditor((state) => { if (state.ready) return {}; return { adjustments: state.adjustments }; });',
      ['setEditor writes adjustments'],
    ],
    ['structural cast', 'store.setEditor(({ history }) as Update);', ['setEditor writes history']],
    ['direct Zustand authority', 'useEditorStore.setState({ adjustmentRevision: 2 });', ['setState writes']],
    ['dynamic Zustand update', 'useEditorStore.setState(update);', ['dynamic']],
    ['explicit hydration', 'store.hydrateEditorRenderAuthority({ adjustments });', ['hydration']],
    [
      'aliased setEditor',
      'const write = store.setEditor; const commit = write; commit({ historyIndex: 2 });',
      ['setEditor writes historyIndex'],
    ],
    [
      'aliased hydration',
      'const hydrate = store.hydrateEditorRenderAuthority; hydrate({ adjustments });',
      ['hydration'],
    ],
    [
      'destructured renamed hydration',
      'const { hydrateEditorRenderAuthority: restore } = store; restore({ adjustments });',
      ['hydration'],
    ],
    [
      'aliased Zustand setState',
      'const publish = useEditorStore.setState; const commit = publish; commit({ history: [] });',
      ['setState writes history'],
    ],
    ['destructured Zustand setState', 'const { setState: publish } = useEditorStore; publish(update);', ['dynamic']],
    ['unrelated setState alias', 'const publish = other.setState; publish({ history: [] });', []],
    ['UI selection allowlist', 'useEditorStore.setState({ activeMaskId: null });', []],
    ['nested proposal', 'store.setEditor({ proposal: { adjustments } });', []],
  ] as const;
  for (const [name, source, expected] of cases) {
    const labels = findEditorRenderAuthorityViolations(`${name}.ts`, source).map(({ label }) => label);
    if (labels.length !== expected.length || expected.some((part) => !labels.some((label) => label.includes(part)))) {
      throw new Error(`${name}: expected ${expected.join('|') || 'none'}, got ${labels.join('|') || 'none'}`);
    }
  }
};

selfTest();
const root = process.cwd();
const files = walkRepoFiles({
  root,
  startDir: `${root}/src`,
  include: ({ repoPath }) =>
    !repoPath.startsWith('src/validation/') && (getExtension(repoPath) === '.ts' || getExtension(repoPath) === '.tsx'),
});
const violations = files.flatMap((file) =>
  findEditorRenderAuthorityViolations(file, readFileSync(file, 'utf8')).map(
    ({ label, line }) => `${relative(root, file)}:${String(line)} ${label}`,
  ),
);
if (violations.length > 0) {
  throw new Error(`editor render-authority boundary violations:\n${violations.join('\n')}`);
}
console.log(`editor render-authority boundary ok (${String(files.length)} production files)`);

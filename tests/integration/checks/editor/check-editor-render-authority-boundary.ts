#!/usr/bin/env bun

import { readFileSync } from 'node:fs';
import { relative } from 'node:path';
import type { Argument, Expression, Node, ObjectExpression, ObjectPropertyKind } from 'oxc-parser';
import { getExtension, walkRepoFiles } from '../../../../scripts/lib/ci/repo-files';
import { lineAtOffset, parseSource, visitSource } from '../../../../scripts/lib/ci/source-ast';

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

const unwrap = (expression: Expression): Expression => {
  let current = expression;
  while (
    current.type === 'ParenthesizedExpression' ||
    current.type === 'TSAsExpression' ||
    current.type === 'TSSatisfiesExpression' ||
    current.type === 'TSTypeAssertion'
  ) {
    current = current.expression;
  }
  return current;
};

const asExpression = (argument: Argument | undefined): Expression | null =>
  argument === undefined || argument.type === 'SpreadElement' ? null : argument;

const objectUpdate = (expression: Expression): ObjectExpression | null => {
  const current = unwrap(expression);
  if (current.type === 'ObjectExpression') return current;
  if (current.type === 'ArrowFunctionExpression' && current.body.type !== 'BlockStatement') {
    const body = unwrap(current.body);
    if (body.type === 'ObjectExpression') return body;
  }
  return null;
};

const objectUpdates = (expression: Expression | null): ObjectExpression[] => {
  if (expression === null) return [];
  const current = unwrap(expression);
  if (current.type !== 'ArrowFunctionExpression' || current.body.type !== 'BlockStatement') {
    const update = objectUpdate(current);
    return update === null ? [] : [update];
  }
  const updates: ObjectExpression[] = [];
  visitSource(current.body, (node) => {
    if (node.type === 'ReturnStatement' && node.argument !== null) {
      const update = objectUpdate(node.argument);
      if (update !== null) updates.push(update);
    }
  });
  return updates;
};

const propertyName = (property: ObjectPropertyKind): string | null => {
  if (property.type !== 'Property' || property.computed) return null;
  if (property.key.type === 'Identifier') return property.key.name;
  return property.key.type === 'Literal' && typeof property.key.value === 'string' ? property.key.value : null;
};

export const findEditorRenderAuthorityViolations = (filePath: string, contents: string): BoundaryViolation[] => {
  const sourceFile = parseSource(filePath, contents);
  const violations: BoundaryViolation[] = [];
  const methodAliases = new Map<string, GuardedEditorMethod>();
  const editorStoreAliases = new Set(['useEditorStore']);
  const report = (node: Node, label: string) => {
    violations.push({
      label,
      line: lineAtOffset(contents, node.start),
    });
  };
  const isEditorStoreExpression = (expression: Expression): boolean => {
    const current = unwrap(expression);
    return current.type === 'Identifier' && editorStoreAliases.has(current.name);
  };
  const resolveGuardedMethod = (expression: Expression): GuardedEditorMethod | null => {
    const current = unwrap(expression);
    if (current.type === 'Identifier') {
      return (
        methodAliases.get(current.name) ??
        (current.name === 'setEditor' || current.name === 'hydrateEditorRenderAuthority' ? current.name : null)
      );
    }
    if (current.type !== 'MemberExpression' || current.computed || current.property.type !== 'Identifier') return null;
    if (current.property.name === 'setEditor' || current.property.name === 'hydrateEditorRenderAuthority') {
      return current.property.name;
    }
    return current.property.name === 'setState' && isEditorStoreExpression(current.object) ? 'setState' : null;
  };
  const bindIdentifier = (name: string, method: GuardedEditorMethod | null): boolean => {
    if (method === null || methodAliases.get(name) === method) return false;
    methodAliases.set(name, method);
    return true;
  };
  const collectAliases = (): void => {
    let changed = true;
    while (changed) {
      changed = false;
      visitSource(sourceFile, (node) => {
        if (node.type === 'VariableDeclarator' && node.init !== null) {
          const initializer = unwrap(node.init);
          if (node.id.type === 'Identifier') {
            if (isEditorStoreExpression(initializer) && !editorStoreAliases.has(node.id.name)) {
              editorStoreAliases.add(node.id.name);
              changed = true;
            }
            changed = bindIdentifier(node.id.name, resolveGuardedMethod(initializer)) || changed;
          } else if (node.id.type === 'ObjectPattern') {
            const fromEditorStore = isEditorStoreExpression(initializer);
            for (const element of node.id.properties) {
              if (element.type !== 'Property' || element.value.type !== 'Identifier') continue;
              const propertyText = propertyName(element);
              const method =
                propertyText === 'setEditor' || propertyText === 'hydrateEditorRenderAuthority'
                  ? propertyText
                  : propertyText === 'setState' && fromEditorStore
                    ? 'setState'
                    : null;
              changed = bindIdentifier(element.value.name, method) || changed;
            }
          }
        } else if (node.type === 'AssignmentExpression' && node.operator === '=' && node.left.type === 'Identifier') {
          changed = bindIdentifier(node.left.name, resolveGuardedMethod(node.right)) || changed;
        }
      });
    }
  };
  collectAliases();
  visitSource(sourceFile, (node) => {
    if (node.type !== 'CallExpression') return;
    const method = resolveGuardedMethod(node.callee);
    const firstArgument = asExpression(node.arguments[0]);
    const update = firstArgument === null ? null : objectUpdate(firstArgument);
    const isGuardedInternalSetStateCall =
      filePath.endsWith('/src/store/useEditorStore.ts') &&
      node.callee.type === 'Identifier' &&
      node.callee.name === 'directEditorStoreSetState';
    if (method === 'setEditor') {
      const forbidden = objectUpdates(firstArgument)
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
  });
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

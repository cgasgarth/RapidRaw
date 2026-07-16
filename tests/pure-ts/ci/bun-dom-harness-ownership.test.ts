import { describe, expect, test } from 'bun:test';
import { relative, resolve } from 'node:path';

import { type Argument, type Expression, parseSync, Visitor } from 'oxc-parser';
import { z } from 'zod';

const repositoryRoot = resolve(import.meta.dir, '../../..');
const pureTestRoot = resolve(repositoryRoot, 'tests/pure-ts');
const sharedPreload = './tests/setup/bun-dom.ts';
const ownedGlobalBindings = new Set(['document', 'IS_REACT_ACT_ENVIRONMENT', 'localStorage', 'navigator', 'window']);
const obsoleteHelperNames = new Set(['installDom', 'installTestDom', 'unmountRenderedRoot']);

type DomHarnessViolationKind =
  | 'bespoke-react-root'
  | 'global-dom-assignment'
  | 'happy-dom-import'
  | 'happy-dom-window'
  | 'obsolete-dom-helper';

interface DomHarnessViolation {
  kind: DomHarnessViolationKind;
  line: number;
}

interface DomHarnessAudit {
  isReactOrDomTest: boolean;
  violations: DomHarnessViolation[];
}

const bunfigSchema = z.object({
  test: z.object({
    preload: z.array(z.string()),
  }),
});

function expressionMember(expression: Expression): { object: string; property: string } | null {
  if (expression.type !== 'MemberExpression' || expression.object.type !== 'Identifier') return null;
  if (!expression.computed && expression.property.type === 'Identifier') {
    return { object: expression.object.name, property: expression.property.name };
  }
  if (expression.computed && expression.property.type === 'Literal' && typeof expression.property.value === 'string') {
    return { object: expression.object.name, property: expression.property.value };
  }
  return null;
}

function argumentIdentifier(argument: Argument | undefined): string | null {
  return argument?.type === 'Identifier' ? argument.name : null;
}

function argumentString(argument: Argument | undefined): string | null {
  return argument?.type === 'Literal' && typeof argument.value === 'string' ? argument.value : null;
}

function sourceLine(source: string, offset: number): number {
  let line = 1;
  for (let index = 0; index < offset; index += 1) {
    if (source.charCodeAt(index) === 10) line += 1;
  }
  return line;
}

export function auditBunDomHarnessSource(path: string, source: string): DomHarnessAudit {
  const parsed = parseSync(path, source);
  const parseErrors = parsed.errors.filter(({ severity }) => severity === 'Error');
  if (parseErrors.length > 0) {
    throw new Error(`${path} could not be audited: ${parseErrors.map(({ message }) => message).join('; ')}`);
  }

  let isReactOrDomTest = path.endsWith('.tsx');
  const violations: DomHarnessViolation[] = [];
  const report = (kind: DomHarnessViolationKind, start: number) => {
    violations.push({ kind, line: sourceLine(source, start) });
  };

  new Visitor({
    AssignmentExpression(node) {
      if (node.left.type !== 'MemberExpression') return;
      const member = expressionMember(node.left);
      if (member?.object !== 'globalThis' || !ownedGlobalBindings.has(member.property)) return;
      report('global-dom-assignment', node.start);
    },
    CallExpression(node) {
      if (node.callee.type === 'Identifier' && node.callee.name === 'createRoot') {
        report('bespoke-react-root', node.start);
        return;
      }
      const member = expressionMember(node.callee);
      if (member === null || argumentIdentifier(node.arguments[0]) !== 'globalThis') return;
      if (member.object === 'Object' && member.property === 'assign') {
        report('global-dom-assignment', node.start);
        return;
      }
      if (member.object === 'Object' && member.property === 'defineProperties') {
        report('global-dom-assignment', node.start);
        return;
      }
      const mutatesNamedBinding =
        (member.object === 'Object' && member.property === 'defineProperty') ||
        (member.object === 'Reflect' && ['defineProperty', 'deleteProperty', 'set'].includes(member.property));
      if (mutatesNamedBinding && ownedGlobalBindings.has(argumentString(node.arguments[1]) ?? '')) {
        report('global-dom-assignment', node.start);
      }
    },
    FunctionDeclaration(node) {
      if (node.id !== null && obsoleteHelperNames.has(node.id.name)) report('obsolete-dom-helper', node.start);
    },
    Identifier(node) {
      if (ownedGlobalBindings.has(node.name)) isReactOrDomTest = true;
    },
    ImportDeclaration(node) {
      const sourceName = node.source.value;
      const isHappyDomImport = sourceName === 'happy-dom' || sourceName.startsWith('@happy-dom/');
      if (isHappyDomImport) report('happy-dom-import', node.start);
      if (sourceName === 'react-dom/client') report('bespoke-react-root', node.start);
      if (isHappyDomImport || sourceName === '@testing-library/react' || sourceName.startsWith('react')) {
        isReactOrDomTest = true;
      }
    },
    JSXElement() {
      isReactOrDomTest = true;
    },
    NewExpression(node) {
      if (node.callee.type === 'Identifier' && node.callee.name === 'Window') {
        report('happy-dom-window', node.start);
      }
    },
    UnaryExpression(node) {
      if (node.operator !== 'delete' || node.argument.type !== 'MemberExpression') return;
      const member = expressionMember(node.argument);
      if (member?.object === 'globalThis' && ownedGlobalBindings.has(member.property)) {
        report('global-dom-assignment', node.start);
      }
    },
    VariableDeclarator(node) {
      if (node.id.type === 'Identifier' && obsoleteHelperNames.has(node.id.name)) {
        report('obsolete-dom-helper', node.start);
      }
    },
  }).visit(parsed.program);

  return {
    isReactOrDomTest,
    violations: violations.sort((left, right) => left.line - right.line || left.kind.localeCompare(right.kind)),
  };
}

async function discoverPureTests(): Promise<string[]> {
  const discovered = new Set<string>();
  for (const pattern of ['**/*.test.ts', '**/*.test.tsx']) {
    const glob = new Bun.Glob(pattern);
    for await (const path of glob.scan({ cwd: pureTestRoot, onlyFiles: true }))
      discovered.add(resolve(pureTestRoot, path));
  }
  return [...discovered].sort();
}

describe('Bun DOM harness ownership', () => {
  test('detects semantic per-file harness ownership without matching comments or strings', () => {
    const audit = auditBunDomHarnessSource(
      'legacy.test.tsx',
      [
        `import { Window } from 'happy-dom';`,
        `import { createRoot } from 'react-dom/client';`,
        `import { GlobalRegistrator } from '@happy-dom/global-registrator';`,
        `const fixture = 'Object.assign(globalThis, { window })';`,
        `function installDom() {}`,
        `const browser = new Window();`,
        `Object.assign(globalThis, { document: browser.document });`,
        `createRoot(document.body);`,
        `Object.defineProperty(globalThis, 'localStorage', { value: browser.localStorage });`,
        `globalThis['window'] = browser;`,
        `delete globalThis.navigator;`,
        `Reflect.defineProperty(globalThis, 'document', { value: browser.document });`,
        `Object.defineProperties(globalThis, { window: { value: browser } });`,
      ].join('\n'),
    );

    expect(audit.violations.map(({ kind }) => kind)).toEqual([
      'happy-dom-import',
      'bespoke-react-root',
      'happy-dom-import',
      'obsolete-dom-helper',
      'happy-dom-window',
      'global-dom-assignment',
      'bespoke-react-root',
      'global-dom-assignment',
      'global-dom-assignment',
      'global-dom-assignment',
      'global-dom-assignment',
      'global-dom-assignment',
    ]);
  });

  test('permits Testing Library and scoped browser API boundaries', () => {
    const audit = auditBunDomHarnessSource(
      'current.test.tsx',
      [
        `import { render } from '@testing-library/react';`,
        `globalThis.ResizeObserver = class TestResizeObserver {};`,
        `render(<main aria-label="Current test" />);`,
      ].join('\n'),
    );

    expect(audit).toEqual({ isReactOrDomTest: true, violations: [] });
  });

  test('keeps every React and DOM Bun test on the shared preload', async () => {
    const paths = await discoverPureTests();
    const audits = await Promise.all(
      paths.map(async (path) => ({
        audit: auditBunDomHarnessSource(path, await Bun.file(path).text()),
        path: relative(repositoryRoot, path),
      })),
    );
    const reactOrDomTests = audits.filter(({ audit }) => audit.isReactOrDomTest);
    const violations = audits.flatMap(({ audit, path }) =>
      audit.violations.map((violation) => ({ path, ...violation })),
    );
    const bunfig = bunfigSchema.parse(Bun.TOML.parse(await Bun.file(resolve(repositoryRoot, 'bunfig.toml')).text()));

    expect(paths.length).toBeGreaterThan(0);
    expect(reactOrDomTests.length).toBeGreaterThan(0);
    expect(bunfig.test.preload).toContain(sharedPreload);
    expect(violations).toEqual([]);
  });
});

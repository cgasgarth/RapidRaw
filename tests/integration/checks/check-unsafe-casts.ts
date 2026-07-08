#!/usr/bin/env bun
// @ts-check

import { readFileSync } from 'node:fs';
import { relative } from 'node:path';

import ts from '@typescript/typescript6';

import { getExtension, walkRepoFiles } from '../../../scripts/lib/ci/repo-files.ts';

const ROOT = process.cwd();

const CHECKED_EXTENSIONS = new Set(['.ts', '.tsx', '.js', '.jsx', '.ts', '.cjs']);

const hasCheckedExtension = (path) => CHECKED_EXTENSIONS.has(getExtension(path));

const getScriptKind = (path) => {
  switch (getExtension(path)) {
    case '.tsx':
      return ts.ScriptKind.TSX;
    case '.jsx':
      return ts.ScriptKind.JSX;
    case '.js':
    case '.ts':
    case '.cjs':
      return ts.ScriptKind.JS;
    default:
      return ts.ScriptKind.TS;
  }
};

const getLine = (sourceFile, position) => sourceFile.getLineAndCharacterOfPosition(position).line + 1;

const unwrapExpression = (node) => {
  let current = node;
  while (ts.isParenthesizedExpression(current)) {
    current = current.expression;
  }
  return current;
};

const getAsExpressionLabel = (node) => {
  if (!ts.isAsExpression(node)) return null;
  if (node.type.kind === ts.SyntaxKind.AnyKeyword) return 'assertion to any';
  const expression = unwrapExpression(node.expression);
  if (ts.isAsExpression(expression) && expression.type.kind === ts.SyntaxKind.UnknownKeyword) {
    return 'double assertion through unknown';
  }
  return null;
};

export const findUnsafeCastViolations = (filePath, contents) => {
  const sourceFile = ts.createSourceFile(filePath, contents, ts.ScriptTarget.Latest, true, getScriptKind(filePath));
  const violations = [];

  const visit = (node) => {
    const label = getAsExpressionLabel(node);
    if (label) {
      violations.push({
        label,
        line: getLine(sourceFile, node.getStart(sourceFile)),
      });
    }

    ts.forEachChild(node, visit);
  };

  visit(sourceFile);
  return violations;
};

const runSelfTest = () => {
  const cases = [
    {
      expected: ['assertion to any'],
      name: 'rejects as any',
      source: 'const value = input as any;',
    },
    {
      expected: ['double assertion through unknown'],
      name: 'rejects unknown chain',
      source: 'const value = input as unknown as Widget;',
    },
    {
      expected: ['double assertion through unknown'],
      name: 'rejects multiline unknown chain',
      source: `const value = (
  input as unknown
) as Widget;`,
    },
    {
      expected: [],
      name: 'allows comments and strings',
      source: `// value as any
const text = "value as unknown as Widget";`,
    },
    {
      expected: [],
      name: 'allows typed helper path',
      source: 'const value = parseWidget(input);',
    },
  ];

  const failures = [];
  for (const testCase of cases) {
    const actual = findUnsafeCastViolations(`${testCase.name}.ts`, testCase.source).map((violation) => violation.label);
    if (actual.join('|') !== testCase.expected.join('|')) {
      failures.push(
        `${testCase.name}: expected ${testCase.expected.join(',') || 'none'}, got ${actual.join(',') || 'none'}`,
      );
    }
  }

  if (failures.length > 0) {
    throw new Error(`unsafe cast self-test failed: ${failures.join('; ')}`);
  }

  console.log('unsafe cast self-test ok');
};

if (process.argv.includes('--self-test')) {
  runSelfTest();
  process.exit(0);
}

const files = walkRepoFiles({ include: ({ repoPath }) => hasCheckedExtension(repoPath) });

const violations = [];
for (const file of files) {
  const contents = readFileSync(file, 'utf8');
  for (const violation of findUnsafeCastViolations(file, contents)) {
    violations.push(`${relative(ROOT, file)}:${violation.line}: banned unsafe cast "${violation.label}"`);
  }
}

if (violations.length > 0) {
  console.error('Unsafe casts are banned. Replace them with typed helpers, schema parsing, or narrowed types.');
  console.error(violations.join('\n'));
  process.exit(1);
}

console.log('No banned unsafe casts found.');

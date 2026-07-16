#!/usr/bin/env bun
// @ts-check

import { readFileSync } from 'node:fs';
import { relative } from 'node:path';

import type { Expression, Node } from 'oxc-parser';

import { getExtension, walkRepoFiles } from '../../../scripts/lib/ci/repo-files.ts';
import { lineAtOffset, parseSource, visitSource } from '../../../scripts/lib/ci/source-ast.ts';

const ROOT = process.cwd();

const CHECKED_EXTENSIONS = new Set(['.ts', '.tsx', '.js', '.jsx', '.ts', '.cjs']);

const hasCheckedExtension = (path) => CHECKED_EXTENSIONS.has(getExtension(path));

const unwrapExpression = (node: Expression): Expression => {
  let current = node;
  while (current.type === 'ParenthesizedExpression') {
    current = current.expression;
  }
  return current;
};

const getAsExpressionLabel = (node: Node): string | null => {
  if (node.type !== 'TSAsExpression') return null;
  if (node.typeAnnotation.type === 'TSAnyKeyword') return 'assertion to any';
  const expression = unwrapExpression(node.expression);
  if (expression.type === 'TSAsExpression' && expression.typeAnnotation.type === 'TSUnknownKeyword') {
    return 'double assertion through unknown';
  }
  return null;
};

export const findUnsafeCastViolations = (filePath: string, contents: string) => {
  const violations: Array<{ label: string; line: number }> = [];
  visitSource(parseSource(filePath, contents), (node) => {
    const label = getAsExpressionLabel(node);
    if (label) {
      violations.push({
        label,
        line: lineAtOffset(contents, node.start),
      });
    }
  });
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

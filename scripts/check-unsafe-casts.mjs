#!/usr/bin/env bun
// @ts-check

import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

import ts from 'typescript';

const ROOT = process.cwd();
const CHECKED_EXTENSIONS = new Set(['.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs']);
const IGNORED_DIRS = new Set(['.git', 'dist', 'node_modules', 'src-tauri/target', 'target']);

const getExtension = (path) => {
  const index = path.lastIndexOf('.');
  return index >= 0 ? path.slice(index) : '';
};

const isIgnored = (path) => {
  const normalized = path.split('/').join('/');
  return [...IGNORED_DIRS].some((ignored) => normalized === ignored || normalized.startsWith(`${ignored}/`));
};

const hasCheckedExtension = (path) => CHECKED_EXTENSIONS.has(getExtension(path));

const getScriptKind = (path) => {
  switch (getExtension(path)) {
    case '.tsx':
      return ts.ScriptKind.TSX;
    case '.jsx':
      return ts.ScriptKind.JSX;
    case '.js':
    case '.mjs':
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

const files = [];
const walk = (dir) => {
  for (const entry of readdirSync(dir)) {
    const absolutePath = join(dir, entry);
    const repoPath = relative(ROOT, absolutePath);
    if (isIgnored(repoPath)) continue;

    const stat = statSync(absolutePath);
    if (stat.isDirectory()) {
      walk(absolutePath);
      continue;
    }

    if (stat.isFile() && hasCheckedExtension(repoPath)) {
      files.push(absolutePath);
    }
  }
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

walk(ROOT);

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

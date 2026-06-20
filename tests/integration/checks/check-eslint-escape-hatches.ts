#!/usr/bin/env bun

import { readdirSync, readFileSync, statSync } from 'node:fs';
import { extname, join, relative } from 'node:path';

import ts from 'typescript';

const ROOT = process.cwd();
const SELF_PATH = 'tests/integration/checks/check-eslint-escape-hatches.ts';
const CHECKED_EXTENSIONS = new Set(['.cjs', '.js', '.jsx', '.ts', '.ts', '.tsx']);
const IGNORED_DIRS = new Set(['.git', 'dist', 'node_modules', 'src-tauri/target', 'target']);
const DIRECTIVE_PREFIX = 'eslint-disable-next-line';
const REASON_MARKER = ' -- ';
const RULE_NAME_PATTERN = /^@?[a-z0-9][a-z0-9-]*(?:\/[a-z0-9][a-z0-9._-]*)?$/u;

const isIgnored = (path) => {
  const normalized = path.split('/').join('/');
  return [...IGNORED_DIRS].some((ignored) => normalized === ignored || normalized.startsWith(`${ignored}/`));
};

const getLine = (sourceFile, position) => sourceFile.getLineAndCharacterOfPosition(position).line + 1;

const stripCommentSyntax = (token, text) => {
  if (token === ts.SyntaxKind.SingleLineCommentTrivia) return text.replace(/^\/\//u, '').trim();
  if (token === ts.SyntaxKind.MultiLineCommentTrivia) return text.replace(/^\/\*/u, '').replace(/\*\/$/u, '').trim();
  return text.trim();
};

const parseDirective = (token, text) => {
  const body = stripCommentSyntax(token, text);
  if (!body.includes('eslint-disable')) return { kind: 'none' };

  if (token !== ts.SyntaxKind.SingleLineCommentTrivia || !body.startsWith(DIRECTIVE_PREFIX)) {
    return { kind: 'invalid', reason: 'use eslint-disable-next-line, not broader disable scopes' };
  }

  const rest = body.slice(DIRECTIVE_PREFIX.length).trim();
  const reasonIndex = rest.indexOf(REASON_MARKER);
  if (reasonIndex < 0) {
    return { kind: 'invalid', reason: 'eslint-disable-next-line requires rule names and a descriptive "-- reason"' };
  }

  const ruleText = rest.slice(0, reasonIndex).trim();
  const reason = rest.slice(reasonIndex + REASON_MARKER.length).trim();
  const rules = ruleText
    .split(/[\s,]+/u)
    .map((rule) => rule.trim())
    .filter(Boolean);

  if (rules.length === 0 || rules.some((rule) => !RULE_NAME_PATTERN.test(rule))) {
    return { kind: 'invalid', reason: 'eslint-disable-next-line requires explicit ESLint rule names' };
  }

  if (reason.length < 12 || !/[A-Z0-9]/u.test(reason[0] ?? '')) {
    return { kind: 'invalid', reason: 'eslint-disable-next-line requires a descriptive "-- reason"' };
  }

  return { kind: 'valid' };
};

const findEslintEscapeViolations = (filePath, contents) => {
  const sourceFile = ts.createSourceFile(filePath, contents, ts.ScriptTarget.Latest, true);
  const scanner = ts.createScanner(ts.ScriptTarget.Latest, false, ts.LanguageVariant.Standard, contents);
  const violations = [];

  let token = scanner.scan();
  while (token !== ts.SyntaxKind.EndOfFileToken) {
    if (token === ts.SyntaxKind.SingleLineCommentTrivia || token === ts.SyntaxKind.MultiLineCommentTrivia) {
      const text = scanner.getTokenText();
      const directive = parseDirective(token, text);
      if (directive.kind === 'invalid') {
        const line = getLine(sourceFile, scanner.getTokenPos());
        violations.push(`${filePath}:${line}: ${directive.reason}`);
      }
    }
    token = scanner.scan();
  }

  return violations;
};

const files = [];
const walk = (dir) => {
  for (const entry of readdirSync(dir)) {
    const absolutePath = join(dir, entry);
    const repoPath = relative(ROOT, absolutePath);
    if (isIgnored(repoPath)) continue;
    if (repoPath === SELF_PATH) continue;

    const stat = statSync(absolutePath);
    if (stat.isDirectory()) {
      walk(absolutePath);
      continue;
    }

    if (stat.isFile() && CHECKED_EXTENSIONS.has(extname(entry))) {
      files.push(absolutePath);
    }
  }
};

const runSelfTest = () => {
  const cases = [
    {
      expected: 0,
      name: 'allows documented next-line disable',
      source:
        '// eslint-disable-next-line @typescript-eslint/no-explicit-any -- Legacy adapter is typed in follow-up issue.\n',
    },
    {
      expected: 1,
      name: 'rejects block disable',
      source: '/* eslint-disable @typescript-eslint/no-explicit-any -- Broad disable */\n',
    },
    {
      expected: 1,
      name: 'rejects same-line disable',
      source:
        '// eslint-disable-line @typescript-eslint/no-explicit-any -- Legacy adapter is typed in follow-up issue.\n',
    },
    {
      expected: 1,
      name: 'rejects missing reason',
      source: '// eslint-disable-next-line @typescript-eslint/no-explicit-any\n',
    },
    {
      expected: 1,
      name: 'rejects missing rule name',
      source: '// eslint-disable-next-line -- Legacy adapter is typed in follow-up issue.\n',
    },
    {
      expected: 1,
      name: 'rejects lowercase short reason',
      source: '// eslint-disable-next-line @typescript-eslint/no-explicit-any -- too short\n',
    },
    {
      expected: 0,
      name: 'ignores string literals',
      source: 'const text = "eslint-disable-next-line @typescript-eslint/no-explicit-any";\n',
    },
  ];

  const failures = [];
  for (const testCase of cases) {
    const actual = findEslintEscapeViolations(`${testCase.name}.ts`, testCase.source).length;
    if (actual !== testCase.expected) {
      failures.push(`${testCase.name}: expected ${String(testCase.expected)}, got ${String(actual)}`);
    }
  }

  if (failures.length > 0) {
    throw new Error(`ESLint escape hatch self-test failed: ${failures.join('; ')}`);
  }

  console.log('eslint escape hatch self-test ok');
};

if (process.argv.includes('--self-test')) {
  runSelfTest();
  process.exit(0);
}

walk(ROOT);

const violations = [];

for (const file of files) {
  const contents = readFileSync(file, 'utf8');
  const repoPath = relative(ROOT, file);
  violations.push(...findEslintEscapeViolations(repoPath, contents));
}

if (violations.length > 0) {
  console.error('ESLint escape hatch policy failed.');
  console.error(violations.join('\n'));
  process.exit(1);
}

console.log('ESLint escape hatches are scoped and documented.');

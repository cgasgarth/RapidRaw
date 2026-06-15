#!/usr/bin/env bun

import { readdirSync, readFileSync, statSync } from 'node:fs';
import { extname, join, relative } from 'node:path';

import ts from 'typescript';

const ROOT = process.cwd();
const SELF_PATH = 'scripts/check-eslint-escape-hatches.mjs';
const CHECKED_EXTENSIONS = new Set(['.cjs', '.js', '.jsx', '.mjs', '.ts', '.tsx']);
const IGNORED_DIRS = new Set(['.git', 'dist', 'node_modules', 'src-tauri/target', 'target']);
const ALLOWED_DIRECTIVE_PATTERN =
  /eslint-disable-next-line\s+[@a-z0-9-/, ]+\s+--\s+[A-Z0-9][A-Za-z0-9 .,:;'"()/_-]{11,}/u;

const isIgnored = (path) => {
  const normalized = path.split('/').join('/');
  return [...IGNORED_DIRS].some((ignored) => normalized === ignored || normalized.startsWith(`${ignored}/`));
};

const getLine = (sourceFile, position) => sourceFile.getLineAndCharacterOfPosition(position).line + 1;

const findEslintEscapeViolations = (filePath, contents) => {
  const sourceFile = ts.createSourceFile(filePath, contents, ts.ScriptTarget.Latest, true);
  const scanner = ts.createScanner(ts.ScriptTarget.Latest, false, ts.LanguageVariant.Standard, contents);
  const violations = [];

  let token = scanner.scan();
  while (token !== ts.SyntaxKind.EndOfFileToken) {
    if (token === ts.SyntaxKind.SingleLineCommentTrivia || token === ts.SyntaxKind.MultiLineCommentTrivia) {
      const text = scanner.getTokenText();
      if (text.includes('eslint-disable')) {
        const line = getLine(sourceFile, scanner.getTokenPos());
        if (token !== ts.SyntaxKind.SingleLineCommentTrivia || !text.includes('eslint-disable-next-line')) {
          violations.push(`${filePath}:${line}: use eslint-disable-next-line, not broader disable scopes`);
        } else if (!ALLOWED_DIRECTIVE_PATTERN.test(text)) {
          violations.push(
            `${filePath}:${line}: eslint-disable-next-line requires rule names and a descriptive "-- reason"`,
          );
        }
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
      name: 'rejects missing reason',
      source: '// eslint-disable-next-line @typescript-eslint/no-explicit-any\n',
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

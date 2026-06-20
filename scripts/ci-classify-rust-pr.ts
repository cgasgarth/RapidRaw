#!/usr/bin/env bun
// @ts-check

import { appendFileSync, readFileSync } from 'node:fs';
import { EOL } from 'node:os';

import { z } from 'zod';

const PullFileSchema = z.object({
  filename: z.string().min(1),
});

const RUST_RELEVANT_PREFIXES = [
  '.cargo/',
  '.github/workflows/lint.yml',
  'scripts/ci-classify-rust-pr.ts',
  'tests/integration/checks/check-rust-feature-policy.ts',
  'src-tauri/',
];

const RUST_RELEVANT_FILES = new Set(['Cargo.toml', 'Cargo.lock', 'rust-toolchain.toml', 'rustfmt.toml']);

const isRustRelevantPath = (path) =>
  RUST_RELEVANT_FILES.has(path) || RUST_RELEVANT_PREFIXES.some((prefix) => path.startsWith(prefix));

const parsePullFilesNdjson = (path) => {
  const lines = readFileSync(path, 'utf8')
    .split(/\r?\n/u)
    .map((line) => line.trim())
    .filter(Boolean);

  return lines.map((line, index) => {
    const parsed = PullFileSchema.safeParse(JSON.parse(line));
    if (!parsed.success) {
      throw new Error(`Invalid pull file entry at line ${index + 1}: ${parsed.error.issues[0]?.message ?? 'unknown'}`);
    }
    return parsed.data.filename;
  });
};

const writeOutput = (name, value) => {
  if (process.env.GITHUB_OUTPUT) {
    appendFileSync(process.env.GITHUB_OUTPUT, `${name}=${value}${EOL}`);
  }
  console.log(`${name}=${value}`);
};

export const classifyRustPrPaths = (paths) => {
  if (paths.length === 0) {
    return { required: true, reason: 'no changed files reported; fail closed' };
  }

  const relevant = paths.filter(isRustRelevantPath);
  return {
    required: relevant.length > 0,
    reason:
      relevant.length > 0
        ? `Rust/Tauri paths changed (${relevant.length})`
        : `No Rust/Tauri paths changed (${paths.length})`,
  };
};

const runSelfTest = () => {
  const cases = [
    { expected: true, name: 'src-tauri source', paths: ['src-tauri/src/lib.rs'] },
    { expected: true, name: 'cargo lock', paths: ['src-tauri/Cargo.lock'] },
    { expected: true, name: 'workflow change', paths: ['.github/workflows/lint.yml'] },
    { expected: false, name: 'frontend package change', paths: ['package.json', 'bun.lock'] },
    { expected: false, name: 'docs only', paths: ['docs/README.md'] },
    { expected: true, name: 'empty fail closed', paths: [] },
  ];

  const failures = cases
    .map((testCase) => {
      const actual = classifyRustPrPaths(testCase.paths).required;
      return actual === testCase.expected ? null : `${testCase.name}: expected ${testCase.expected}, got ${actual}`;
    })
    .filter(Boolean);

  if (failures.length > 0) {
    throw new Error(`Rust PR classifier self-test failed: ${failures.join('; ')}`);
  }

  console.log('rust PR classifier self-test ok');
};

if (process.argv.includes('--self-test')) {
  runSelfTest();
  process.exit(0);
}

const ndjsonIndex = process.argv.indexOf('--pull-files-ndjson');
const paths = ndjsonIndex >= 0 ? parsePullFilesNdjson(process.argv[ndjsonIndex + 1] ?? '') : [];
const result = classifyRustPrPaths(paths);
writeOutput('rust_ci_required', result.required ? 'true' : 'false');
writeOutput('rust_ci_reason', result.reason);

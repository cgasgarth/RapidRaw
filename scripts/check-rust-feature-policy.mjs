#!/usr/bin/env bun

import { readFileSync } from 'node:fs';

const REQUIRED_FEATURE_ARGS = '--no-default-features --features required-ci';

const checkedFiles = [
  {
    path: 'package.json',
    source: readFileSync('package.json', 'utf8'),
  },
  {
    path: '.github/workflows/lint.yml',
    source: readFileSync('.github/workflows/lint.yml', 'utf8'),
  },
];

const requiredCargoCommandPatterns = [
  /cargo check --locked --no-default-features --features required-ci/u,
  /cargo clippy --locked --all-targets --no-default-features --features required-ci -- -D warnings/u,
  /cargo test --locked --all-targets --no-default-features --features required-ci --no-fail-fast/u,
];

const violations = [];

for (const { path, source } of checkedFiles) {
  if (source.includes('--all-features')) {
    violations.push(`${path}: required Rust checks must not use --all-features; use ${REQUIRED_FEATURE_ARGS}`);
  }
}

for (const pattern of requiredCargoCommandPatterns) {
  for (const { path, source } of checkedFiles) {
    if (!pattern.test(source)) {
      violations.push(`${path}: missing required Rust feature policy command matching ${pattern.source}`);
    }
  }
}

if (violations.length > 0) {
  console.error('Rust feature policy validation failed.');
  console.error(violations.join('\n'));
  process.exit(1);
}

console.log('Validated Rust required feature policy.');

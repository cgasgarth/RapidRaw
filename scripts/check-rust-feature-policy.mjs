#!/usr/bin/env bun

import { readdirSync, readFileSync } from 'node:fs';
import { extname, join } from 'node:path';

const REQUIRED_FEATURE_ARGS = '--no-default-features --features required-ci';

const workflowFiles = readdirSync('.github/workflows')
  .filter((file) => ['.yml', '.yaml'].includes(extname(file)))
  .map((file) => {
    const path = join('.github/workflows', file);

    return {
      path,
      source: readFileSync(path, 'utf8'),
    };
  });

const checkedFiles = [
  {
    path: 'package.json',
    source: readFileSync('package.json', 'utf8'),
  },
  ...workflowFiles,
];

const requiredCargoCommandPatterns = [
  /cargo check --locked --no-default-features --features required-ci/u,
  /cargo clippy --locked --all-targets --no-default-features --features required-ci -- -D warnings/u,
  /cargo test (?:--quiet )?--locked --all-targets --no-default-features --features required-ci --no-fail-fast/u,
];

const violations = [];

for (const { path, source } of checkedFiles) {
  if (source.includes('--all-features')) {
    violations.push(`${path}: required Rust checks must not use --all-features; use ${REQUIRED_FEATURE_ARGS}`);
  }
}

for (const pattern of requiredCargoCommandPatterns) {
  if (!checkedFiles.some(({ source }) => pattern.test(source))) {
    violations.push(`missing required Rust feature policy command matching ${pattern.source}`);
  }
}

if (violations.length > 0) {
  console.error('Rust feature policy validation failed.');
  console.error(violations.join('\n'));
  process.exit(1);
}

console.log('Validated Rust required feature policy.');

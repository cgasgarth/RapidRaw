#!/usr/bin/env bun

import { readdirSync, readFileSync } from 'node:fs';
import { extname, join } from 'node:path';

const REQUIRED_FEATURE_ARGS = '--no-default-features --features required-ci';
const ALL_FEATURES_ALLOWED_FILES = new Set(['.github/workflows/panorama-opencv-spike.yml']);

const requiredCargoCommandPatterns = [
  /cargo check --locked --no-default-features --features required-ci/u,
  /cargo clippy --locked --all-targets --no-default-features --features required-ci -- -D warnings/u,
  /cargo test (?:--quiet )?--locked --all-targets --no-default-features --features required-ci --no-fail-fast/u,
];

const readRepositoryFiles = () => {
  const workflowFiles = readdirSync('.github/workflows')
    .filter((file) => ['.yml', '.yaml'].includes(extname(file)))
    .map((file) => {
      const path = join('.github/workflows', file);

      return {
        path,
        source: readFileSync(path, 'utf8'),
      };
    });

  return [
    {
      path: 'package.json',
      source: readFileSync('package.json', 'utf8'),
    },
    ...workflowFiles,
  ];
};

const validateRustFeaturePolicy = (checkedFiles) => {
  const violations = [];

  for (const { path, source } of checkedFiles) {
    if (source.includes('--all-features') && !ALL_FEATURES_ALLOWED_FILES.has(path)) {
      violations.push(`${path}: required Rust checks must not use --all-features; use ${REQUIRED_FEATURE_ARGS}`);
    }
  }

  const featureMatrix = checkedFiles.find(({ path }) => path === '.github/workflows/panorama-opencv-spike.yml');
  if (
    !featureMatrix?.source.includes('schedule:') ||
    !featureMatrix.source.includes('cargo check --locked --all-targets --all-features')
  ) {
    violations.push(
      'scheduled Rust feature matrix must run cargo check with --all-features in panorama-opencv-spike.yml',
    );
  }

  for (const pattern of requiredCargoCommandPatterns) {
    if (!checkedFiles.some(({ source }) => pattern.test(source))) {
      violations.push(`missing required Rust feature policy command matching ${pattern.source}`);
    }
  }

  return violations;
};

const runSelfTest = () => {
  const validFiles = [
    {
      path: 'package.json',
      source:
        'cargo check --locked --no-default-features --features required-ci\ncargo clippy --locked --all-targets --no-default-features --features required-ci -- -D warnings\ncargo test --quiet --locked --all-targets --no-default-features --features required-ci --no-fail-fast',
    },
    {
      path: '.github/workflows/panorama-opencv-spike.yml',
      source: 'schedule:\n  - cron: "17 10 * * 1"\nrun: cargo check --locked --all-targets --all-features',
    },
  ];

  const validViolations = validateRustFeaturePolicy(validFiles);
  if (validViolations.length > 0) {
    throw new Error(`self-test failed: valid policy rejected: ${validViolations.join('; ')}`);
  }

  const requiredAllFeatures = validateRustFeaturePolicy([
    ...validFiles,
    {
      path: '.github/workflows/lint.yml',
      source: 'run: cargo check --locked --all-targets --all-features',
    },
  ]);
  if (!requiredAllFeatures.some((violation) => violation.includes('must not use --all-features'))) {
    throw new Error('self-test failed: required all-features use was not rejected');
  }

  const missingSchedule = validateRustFeaturePolicy([
    validFiles[0],
    {
      path: '.github/workflows/panorama-opencv-spike.yml',
      source: 'workflow_dispatch:\nrun: cargo check --locked --all-targets --all-features',
    },
  ]);
  if (!missingSchedule.some((violation) => violation.includes('scheduled Rust feature matrix'))) {
    throw new Error('self-test failed: missing scheduled feature matrix was not rejected');
  }

  console.log('rust feature policy self-test ok');
};

if (process.argv.includes('--self-test')) {
  runSelfTest();
  process.exit(0);
}

const violations = validateRustFeaturePolicy(readRepositoryFiles());

if (violations.length > 0) {
  console.error('Rust feature policy validation failed.');
  console.error(violations.join('\n'));
  process.exit(1);
}

console.log('Validated Rust required feature policy.');

#!/usr/bin/env bun

import { readFileSync } from 'node:fs';

const hook = readFileSync('.githooks/pre-commit', 'utf8');
const unconditionalSection =
  hook.split("if printf '%s\\n' \"$staged_files\" | grep -Eq '^(AGENTS\\.md|docs/|.*\\.md$)'")[0] ?? hook;

if (unconditionalSection.includes('check:external-editor-missing-launcher')) {
  throw new Error('pre-commit must not run slow Rust cargo tests before staged-file routing.');
}

for (const slowGate of ['build:frontend', 'check:visual-smoke:pr', 'check:browser-tauri-harness']) {
  if (hook.includes(slowGate)) {
    throw new Error(`pre-commit must leave ${slowGate} to CI or explicit local validation.`);
  }
}

const schemaRoutingLine = hook.split('\n').find((line) => line.includes('schema:check')) ?? '';
const schemaRoutingCondition = hook
  .split('\n')
  .slice(
    0,
    hook.split('\n').findIndex((line) => line === schemaRoutingLine),
  )
  .findLast((line) => line.includes("grep -Eq '"));
if (schemaRoutingCondition?.includes('package\\.json') || schemaRoutingCondition?.includes('tsconfig')) {
  throw new Error('pre-commit must not route package/tsconfig-only changes into heavy schema gates.');
}

if (
  !hook.includes("grep -Eq '^(src-tauri/.*\\.rs|src-tauri/Cargo\\.(toml|lock)|\\.cargo/.*|rust-toolchain\\.toml)$'")
) {
  throw new Error('pre-commit must keep Rust checks for Rust file changes.');
}

for (const requiredFastGate of ['bun lint-staged --quiet --concurrent false', 'bun run check:lint']) {
  if (!unconditionalSection.includes(requiredFastGate)) {
    throw new Error(`pre-commit fast path missing required gate: ${requiredFastGate}`);
  }
}

console.log('precommit fast path ok');

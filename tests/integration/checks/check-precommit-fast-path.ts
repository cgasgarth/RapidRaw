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

const unusedDepsLine = hook.split('\n').find((line) => line.includes('check:unused-deps')) ?? '';
const unusedDepsCondition = hook
  .split('\n')
  .slice(
    0,
    hook.split('\n').findIndex((line) => line === unusedDepsLine),
  )
  .findLast((line) => line.includes("grep -Eq '"));
if (unusedDepsCondition && /(src\/|scripts\/|tests\/)/u.test(unusedDepsCondition)) {
  throw new Error('pre-commit must leave source/test unused-dependency audits to CI.');
}

if (
  !hook.includes("grep -Eq '^(src-tauri/.*\\.rs|src-tauri/Cargo\\.(toml|lock)|\\.cargo/.*|rust-toolchain\\.toml)$'")
) {
  throw new Error('pre-commit must keep Rust checks for Rust file changes.');
}

const rustRoutingLine = hook.split('\n').find((line) => line.includes('check:rust:fmt')) ?? '';
const rustRoutingStart = hook
  .split('\n')
  .slice(
    0,
    hook.split('\n').findIndex((line) => line === rustRoutingLine),
  )
  .findLastIndex((line) => line.startsWith('if printf'));
const rustRoutingEnd = hook
  .split('\n')
  .slice(hook.split('\n').findIndex((line) => line === rustRoutingLine))
  .findIndex((line) => line === 'fi');
const rustRoutingBlock = hook
  .split('\n')
  .slice(rustRoutingStart, hook.split('\n').findIndex((line) => line === rustRoutingLine) + rustRoutingEnd + 1)
  .join('\n');

for (const heavyRustGate of ['check:rust:check', 'check:rust:clippy', 'check:rust:test']) {
  if (rustRoutingBlock.includes(heavyRustGate)) {
    throw new Error(`pre-commit must leave ${heavyRustGate} to CI or explicit local validation.`);
  }
}

for (const requiredFastGate of ['bun lint-staged --quiet --concurrent false', 'bun run check:lint']) {
  if (!unconditionalSection.includes(requiredFastGate)) {
    throw new Error(`pre-commit fast path missing required gate: ${requiredFastGate}`);
  }
}

console.log('precommit fast path ok');

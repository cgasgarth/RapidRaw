#!/usr/bin/env bun

import { readdirSync } from 'node:fs';
import process from 'node:process';

const SCRIPT_DIR = 'scripts';
const LEGACY_SCRIPT_EXTENSION_PATTERN = /^scripts\/.+\.(?:js|mjs)$/u;

export const collectFiles = (directory: string): string[] =>
  readdirSync(directory, { withFileTypes: true })
    .flatMap((entry) => {
      const path = `${directory}/${entry.name}`;
      return entry.isDirectory() ? collectFiles(path) : [path];
    })
    .sort();

export const findExtensionPolicyViolations = (scriptFiles: readonly string[]): string[] =>
  scriptFiles.filter((path) => LEGACY_SCRIPT_EXTENSION_PATTERN.test(path)).sort();

const runSelfTest = (): void => {
  const legacyPath = `scripts/lib/new.${'mjs'}`;
  const scriptFiles = ['scripts/existing.ts', 'scripts/helper.ts', 'scripts/lib/new.ts', legacyPath];

  const violations = findExtensionPolicyViolations(scriptFiles);

  if (violations.length !== 1 || violations[0] !== legacyPath) {
    throw new Error('script extension policy self-test failed: missing violation');
  }

  console.log('script extension policy self-test ok');
};

if (process.argv.includes('--self-test')) {
  runSelfTest();
  process.exit(0);
}

const scriptFiles = collectFiles(SCRIPT_DIR);
const violations = findExtensionPolicyViolations(scriptFiles);

if (violations.length > 0) {
  console.error(`legacy script extensions banned: ${violations.slice(0, 10).join(', ')}. Use .ts scripts.`);
  process.exit(1);
}

console.log('script extension policy ok (0 js/mjs scripts)');

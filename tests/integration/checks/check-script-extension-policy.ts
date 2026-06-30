#!/usr/bin/env bun

import { readdirSync, readFileSync } from 'node:fs';
import process from 'node:process';

const SCRIPT_DIR = 'scripts';
const TEST_CHECK_DIR = 'tests/integration/checks';
const PACKAGE_JSON_PATH = 'package.json';
const LEGACY_SCRIPT_EXTENSION_PATTERN = /^(?:scripts|tests\/integration\/checks)\/.+\.(?:js|mjs)$/u;
const LEGACY_SCRIPT_REFERENCE_PATTERN = /\b[\w./-]+\.(?:js|mjs)\b/u;

export const collectFiles = (directory: string): string[] =>
  readdirSync(directory, { withFileTypes: true })
    .flatMap((entry) => {
      const path = `${directory}/${entry.name}`;
      return entry.isDirectory() ? collectFiles(path) : [path];
    })
    .sort();

export const findExtensionPolicyViolations = (scriptFiles: readonly string[]): string[] =>
  scriptFiles.filter((path) => LEGACY_SCRIPT_EXTENSION_PATTERN.test(path)).sort();

const isStringRecord = (value: unknown): value is Record<string, string> =>
  typeof value === 'object' && value !== null && Object.values(value).every((entry) => typeof entry === 'string');

export const collectPackageScriptReferences = (packageJsonSource: string): string[] => {
  const packageJson: unknown = JSON.parse(packageJsonSource);

  if (typeof packageJson !== 'object' || packageJson === null || !('scripts' in packageJson)) {
    return [];
  }

  const scripts = packageJson.scripts;
  if (!isStringRecord(scripts)) {
    throw new Error('package.json scripts must be a string map');
  }

  return Object.entries(scripts)
    .filter(([, command]) => LEGACY_SCRIPT_REFERENCE_PATTERN.test(command))
    .map(([name, command]) => `${name}: ${command}`)
    .sort();
};

const runSelfTest = (): void => {
  const legacyPath = `scripts/lib/new.${'mjs'}`;
  const scriptFiles = ['scripts/existing.ts', 'tests/integration/checks/helper.ts', 'scripts/lib/new.ts', legacyPath];

  const violations = findExtensionPolicyViolations(scriptFiles);

  if (violations.length !== 1 || violations[0] !== legacyPath) {
    throw new Error('script extension policy self-test failed: missing violation');
  }

  const packageReferences = collectPackageScriptReferences(
    JSON.stringify({
      scripts: {
        allowed: 'bun scripts/check.ts',
        legacy: `bun scripts/check.${'mjs'}`,
      },
    }),
  );

  if (packageReferences.length !== 1 || !packageReferences[0]?.startsWith('legacy:')) {
    throw new Error('script extension policy self-test failed: missing package script reference');
  }

  console.log('script extension policy self-test ok');
};

if (process.argv.includes('--self-test')) {
  runSelfTest();
  process.exit(0);
}

const scriptFiles = [...collectFiles(SCRIPT_DIR), ...collectFiles(TEST_CHECK_DIR)];
const violations = findExtensionPolicyViolations(scriptFiles);
const packageScriptReferences = collectPackageScriptReferences(readFileSync(PACKAGE_JSON_PATH, 'utf8'));

if (violations.length > 0 || packageScriptReferences.length > 0) {
  console.error(
    [
      `legacy script extensions banned; use .ts scripts.`,
      `files: ${violations.slice(0, 10).join(', ') || 'none'}`,
      `package scripts: ${packageScriptReferences.slice(0, 10).join(', ') || 'none'}`,
    ].join('\n'),
  );
  process.exit(1);
}

console.log('script extension policy ok (0 js/mjs scripts or package refs)');

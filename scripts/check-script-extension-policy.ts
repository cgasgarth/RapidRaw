#!/usr/bin/env bun

import { readdirSync, readFileSync } from 'node:fs';
import process from 'node:process';

import { z } from 'zod';

const SCRIPT_DIR = 'scripts';
const LEGACY_ALLOWLIST_PATH = 'scripts/legacy-script-extension-allowlist.json';
const LEGACY_SCRIPT_EXTENSION_PATTERN = /^scripts\/.+\.(?:js|mjs)$/u;

const legacyAllowlistSchema = z.array(z.string().regex(LEGACY_SCRIPT_EXTENSION_PATTERN));

export const collectFiles = (directory: string): string[] =>
  readdirSync(directory, { withFileTypes: true })
    .flatMap((entry) => {
      const path = `${directory}/${entry.name}`;
      return entry.isDirectory() ? collectFiles(path) : [path];
    })
    .sort();

export const findExtensionPolicyViolations = ({
  legacyAllowlist,
  scriptFiles,
}: {
  legacyAllowlist: ReadonlySet<string>;
  scriptFiles: readonly string[];
}): string[] =>
  scriptFiles
    .filter((path) => LEGACY_SCRIPT_EXTENSION_PATTERN.test(path))
    .filter((path) => !legacyAllowlist.has(path))
    .sort();

export const findStaleAllowlistEntries = ({
  legacyAllowlist,
  scriptFiles,
}: {
  legacyAllowlist: ReadonlySet<string>;
  scriptFiles: readonly string[];
}): string[] => {
  const fileSet = new Set(scriptFiles);
  return [...legacyAllowlist].filter((path) => !fileSet.has(path)).sort();
};

const readLegacyAllowlist = (): Set<string> => {
  const parsedJson: unknown = JSON.parse(readFileSync(LEGACY_ALLOWLIST_PATH, 'utf8'));
  return new Set(legacyAllowlistSchema.parse(parsedJson));
};

const runSelfTest = (): void => {
  const scriptFiles = [
    'scripts/existing.mjs',
    'scripts/helper.ts',
    'scripts/lib/existing.js',
    'scripts/lib/new.mjs',
    'scripts/lib/new.ts',
  ];
  const legacyAllowlist = new Set(['scripts/existing.mjs', 'scripts/lib/existing.js', 'scripts/stale.mjs']);

  const violations = findExtensionPolicyViolations({ legacyAllowlist, scriptFiles });
  const staleEntries = findStaleAllowlistEntries({ legacyAllowlist, scriptFiles });

  if (violations.length !== 1 || violations[0] !== 'scripts/lib/new.mjs') {
    throw new Error('script extension policy self-test failed: missing violation');
  }

  if (staleEntries.length !== 1 || staleEntries[0] !== 'scripts/stale.mjs') {
    throw new Error('script extension policy self-test failed: missing stale entry');
  }

  console.log('script extension policy self-test ok');
};

if (process.argv.includes('--self-test')) {
  runSelfTest();
  process.exit(0);
}

const scriptFiles = collectFiles(SCRIPT_DIR);
const legacyAllowlist = readLegacyAllowlist();
const violations = findExtensionPolicyViolations({ legacyAllowlist, scriptFiles });
const staleEntries = findStaleAllowlistEntries({ legacyAllowlist, scriptFiles });

if (violations.length > 0 || staleEntries.length > 0) {
  const lines = [
    violations.length > 0 ? `new legacy script extensions: ${violations.slice(0, 10).join(', ')}` : '',
    staleEntries.length > 0 ? `stale allowlist entries: ${staleEntries.slice(0, 10).join(', ')}` : '',
  ].filter((line) => line.length > 0);

  console.error(`${lines.join('; ')}. Use .ts for new scripts and remove migrated files from the allowlist.`);
  process.exit(1);
}

console.log(`script extension policy ok (${legacyAllowlist.size} legacy js/mjs scripts grandfathered)`);

#!/usr/bin/env bun

import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const CHECK_DIR = 'tests/integration/checks';
const LEGACY_CHECK_DIR = 'scripts';
const CHECK_COMMAND_PATTERN = /\btests\/integration\/checks\/check-[\w-]+\.ts\b/gu;
const LEGACY_CHECK_PATTERN = /(?:^|[\s"'])scripts\/check-[\w-]+\.ts\b/u;

const isStringRecord = (value: unknown): value is Record<string, string> =>
  typeof value === 'object' && value !== null && Object.values(value).every((entry) => typeof entry === 'string');

const packageJson: unknown = JSON.parse(readFileSync('package.json', 'utf8'));
if (typeof packageJson !== 'object' || packageJson === null || !('scripts' in packageJson)) {
  throw new Error('package.json scripts missing.');
}
if (!isStringRecord(packageJson.scripts)) {
  throw new Error('package.json scripts must be a string map.');
}

const failures = [];
const legacyCheckFiles = readdirSync(LEGACY_CHECK_DIR).filter((file) => /^check-[\w-]+\.ts$/u.test(file));
if (legacyCheckFiles.length > 0) {
  failures.push(`Legacy top-level check files remain in scripts/: ${legacyCheckFiles.slice(0, 10).join(', ')}`);
}

for (const [scriptName, command] of Object.entries(packageJson.scripts)) {
  if (LEGACY_CHECK_PATTERN.test(command)) {
    failures.push(`package.json script ${scriptName} still references scripts/check-*.ts`);
  }

  for (const match of command.matchAll(CHECK_COMMAND_PATTERN)) {
    const path = match[0];
    if (!existsSync(path)) {
      failures.push(`package.json script ${scriptName} points at missing ${path}`);
    }
  }
}

const checkFiles = readdirSync(CHECK_DIR).filter((file) => /^check-[\w-]+\.ts$/u.test(file));
for (const file of checkFiles) {
  if (!existsSync(join(CHECK_DIR, file))) {
    failures.push(`${CHECK_DIR}/${file} is missing.`);
  }
}

if (failures.length > 0) {
  console.error('validation test path migration failed:');
  for (const failure of failures.slice(0, 20)) console.error(`- ${failure}`);
  process.exit(1);
}

console.log(`validation test paths ok (${checkFiles.length} checks)`);

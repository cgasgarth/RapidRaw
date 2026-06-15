#!/usr/bin/env bun
// @ts-check

import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const SCRIPT_DIR = 'scripts';
const MAX_SCRIPTS_WITHOUT_TS_CHECK = 120;

const scriptFiles = readdirSync(SCRIPT_DIR)
  .filter((fileName) => fileName.endsWith('.js') || fileName.endsWith('.mjs'))
  .map((fileName) => join(SCRIPT_DIR, fileName))
  .sort();

const missingTsCheck = scriptFiles.filter((filePath) => {
  const firstLines = readFileSync(filePath, 'utf8').split(/\r?\n/u).slice(0, 3).join('\n');
  return !firstLines.includes('@ts-check');
});

if (missingTsCheck.length > MAX_SCRIPTS_WITHOUT_TS_CHECK) {
  const newDebt = missingTsCheck.slice(MAX_SCRIPTS_WITHOUT_TS_CHECK, MAX_SCRIPTS_WITHOUT_TS_CHECK + 10);
  throw new Error(
    `Script @ts-check debt increased: ${missingTsCheck.length}/${scriptFiles.length} missing. New files need @ts-check or a typed-script plan. Examples: ${newDebt.join(', ')}`,
  );
}

console.log(
  `script type coverage ok (${scriptFiles.length - missingTsCheck.length}/${scriptFiles.length} @ts-check, debt cap ${MAX_SCRIPTS_WITHOUT_TS_CHECK})`,
);

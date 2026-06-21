#!/usr/bin/env bun

import { readFile } from 'node:fs/promises';

const [modalSource, packageJson, currentPrLocal] = await Promise.all([
  readFile('src/components/modals/CommandPaletteModal.tsx', 'utf8'),
  readFile('package.json', 'utf8'),
  readFile('tests/integration/checks/check-current-pr-local.ts', 'utf8'),
]);

const requiredModalSnippets = [
  "command.id === 'panorama'",
  'panoramaModalState',
  'stitchingSourcePaths:',
  'selectedCommandPaths.length > 0 ? selectedCommandPaths',
  "command.id === 'hdrMerge'",
  'hdrModalState',
  "command.id === 'focusStack'",
  'focusStackModalState',
  'sourcePaths:',
  "command.id === 'superResolution'",
  'superResolutionModalState',
];
const failures = requiredModalSnippets
  .filter((snippet) => !modalSource.includes(snippet))
  .map((snippet) => `missing modal snippet: ${snippet}`);

if (!packageJson.includes('"check:command-palette-merge-sources-ui"')) {
  failures.push('missing package script: check:command-palette-merge-sources-ui');
}
if (!currentPrLocal.includes("'check:command-palette-merge-sources-ui'")) {
  failures.push('missing current-pr-local route: check:command-palette-merge-sources-ui');
}

if (failures.length > 0) {
  console.error('command palette merge sources UI check failed');
  for (const failure of failures.slice(0, 12)) console.error(`- ${failure}`);
  process.exit(1);
}

console.log('command palette merge sources UI ok');

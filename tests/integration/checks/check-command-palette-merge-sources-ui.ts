#!/usr/bin/env bun

import { readFile } from 'node:fs/promises';

const [modalSource, packageJson] = await Promise.all([
  readFile('src/components/modals/CommandPaletteModal.tsx', 'utf8'),
  readFile('package.json', 'utf8'),
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

const panoramaHandler = modalSource.match(
  /command\.id === 'panorama'[\s\S]*?panoramaModalState:\s*\{(?<handler>[\s\S]*?)stitchingSourcePaths:/u,
)?.groups?.handler;
if (!panoramaHandler?.includes('finalImageBase64: null')) {
  failures.push('panorama command palette action must clear stale rendered output');
}
if (!panoramaHandler?.includes('lastDryRunCommand: null')) {
  failures.push('panorama command palette action must clear stale dry-run command metadata');
}
if (!panoramaHandler?.includes('renderedReview: null')) {
  failures.push('panorama command palette action must clear stale rendered review');
}
if (!panoramaHandler?.includes('runtimePlan: null')) {
  failures.push('panorama command palette action must clear stale runtime plan');
}

const hdrHandler = modalSource.match(/command\.id === 'hdrMerge'(?<handler>[\s\S]*?)stitchingSourcePaths:/u)?.groups
  ?.handler;
if (!hdrHandler?.includes('lastDryRunCommand: _lastDryRunCommand')) {
  failures.push('HDR command palette action must omit stale dry-run command metadata');
}
if (!hdrHandler?.includes('finalImageBase64: null')) {
  failures.push('HDR command palette action must clear stale rendered output');
}

const focusHandler = modalSource.match(/command\.id === 'focusStack'(?<handler>[\s\S]*?)sourcePaths:/u)?.groups
  ?.handler;
if (!focusHandler?.includes('lastDryRunCommand: _lastDryRunCommand')) {
  failures.push('focus stack command palette action must omit stale dry-run command metadata');
}

const superResolutionHandler = modalSource.match(/command\.id === 'superResolution'(?<handler>[\s\S]*?)sourcePaths:/u)
  ?.groups?.handler;
if (!superResolutionHandler?.includes('lastDryRunCommand: _lastDryRunCommand')) {
  failures.push('super-resolution command palette action must omit stale dry-run command metadata');
}

if (!packageJson.includes('"check:command-palette-merge-sources-ui"')) {
  failures.push('missing package script: check:command-palette-merge-sources-ui');
}
if (failures.length > 0) {
  console.error('command palette merge sources UI check failed');
  for (const failure of failures.slice(0, 12)) console.error(`- ${failure}`);
  process.exit(1);
}

console.log('command palette merge sources UI ok');

#!/usr/bin/env bun

import { readFile } from 'node:fs/promises';

const controlsPanel = await readFile('src/components/panel/right/color/ControlsPanel.tsx', 'utf8');
const commands = await readFile('src/tauri/commands.ts', 'utf8');
const imageLoader = await readFile('src-tauri/src/image_loader.rs', 'utf8');
const lib = await readFile('src-tauri/src/lib.rs', 'utf8');
const schema = await readFile('src/schemas/rawReconstructionComparisonSchemas.ts', 'utf8');
const en = JSON.parse(await readFile('src/i18n/locales/en.json', 'utf8'));

for (const marker of [
  'data-testid="raw-reconstruction-comparison-run"',
  'data-testid="raw-reconstruction-comparison-result"',
  'Invokes.CompareRawReconstructionModes',
  'rawReconstructionComparisonResultSchema',
  'cropDataUrl',
  'cropHash',
  'decodeElapsedMs',
  'estimatedMemoryBytes',
  'proofBoundary',
]) {
  if (!controlsPanel.includes(marker) && !schema.includes(marker)) {
    throw new Error(`RAW reconstruction comparison UI/schema marker missing: ${marker}`);
  }
}

for (const marker of [
  "CompareRawReconstructionModes = 'compare_raw_reconstruction_modes'",
  'compare_raw_reconstruction_modes',
]) {
  if (!commands.includes(marker) && !lib.includes(marker) && !imageLoader.includes(marker)) {
    throw new Error(`RAW reconstruction comparison command marker missing: ${marker}`);
  }
}

if (en.editor.adjustments.rawReconstructionComparison?.action !== 'Compare 100% crops') {
  throw new Error('RAW reconstruction comparison i18n action key missing.');
}

console.log('raw reconstruction comparison ui ok');

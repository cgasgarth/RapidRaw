#!/usr/bin/env bun

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const docPath = resolve('docs/baseline/rapidraw-layer-mask-model-audit-2026-06-15.md');
const doc = readFileSync(docPath, 'utf8');

const requiredDocFragments = [
  'src/utils/adjustments.ts',
  'MaskContainer',
  'MaskAdjustments',
  'AiPatch',
  'src/components/panel/right/layers/MasksPanel.tsx',
  'src/components/panel/right/layers/LayerStackPanel.tsx',
  'src/utils/layers/layerStack.ts',
  'src/utils/layers/layerAdjustments.ts',
  'src-tauri/src/mask_generation.rs',
  'graph-native layer',
  'Blend mode is not persisted or rendered',
  'legacy dynamic bags',
];

for (const fragment of requiredDocFragments) {
  if (!doc.includes(fragment)) {
    console.error(`Layer/mask audit missing fragment: ${fragment}`);
    process.exit(1);
  }
}

const sourceChecks = [
  ['src/utils/adjustments.ts', 'export interface MaskContainer'],
  ['src/utils/adjustments.ts', 'export interface AiPatch'],
  ['src/components/panel/right/layers/LayerStackPanel.tsx', 'function getLayerRows'],
  ['src/utils/layers/layerStack.ts', 'export function moveLayer'],
  ['src/utils/layers/layerAdjustments.ts', 'export const LAYER_ADJUSTMENT_KEYS'],
  ['src-tauri/src/mask_generation.rs', 'pub fn generate_mask_bitmap'],
];

for (const [path, fragment] of sourceChecks) {
  const source = readFileSync(resolve(path), 'utf8');
  if (!source.includes(fragment)) {
    console.error(`${path} missing expected audit source fragment: ${fragment}`);
    process.exit(1);
  }
}

console.log('Layer/mask model audit ok.');

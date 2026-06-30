#!/usr/bin/env bun

import { readFileSync } from 'node:fs';

const source = readFileSync('src/components/panel/right/layers/LayerStackPanel.tsx', 'utf8');

for (const marker of [
  'LAYER_OPACITY_PRESETS = [0, 25, 50, 75, 100]',
  'layer-opacity-presets',
  'layer-opacity-preset-${presetOpacity}',
  'layer-stack-count',
  'layer-visible-count',
  'editor.layers.layerCount',
  'editor.layers.visibleLayerCount',
  'visibleLayerCount = masks.filter',
  'updateActiveOpacity(presetOpacity)',
  'editor.layers.opacityPreset',
]) {
  if (!source.includes(marker)) {
    throw new Error(`Layer opacity preset UI missing marker: ${marker}`);
  }
}

console.log('layer opacity presets ok (5 presets)');

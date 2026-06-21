#!/usr/bin/env bun

import { readFileSync } from 'node:fs';

const locale = JSON.parse(readFileSync('src/i18n/locales/en.json', 'utf8'));
const layerLocale = locale.editor?.layers;
const requiredLocaleKeys = [
  'groupSummaryCount',
  'groupSummaryCount_one',
  'groupSummaryCount_other',
  'hiddenLayerCount',
  'hiddenLayerCount_one',
  'hiddenLayerCount_other',
  'layerCount',
  'visibleLayerCount',
];
const requiredActionLocaleKeys = ['showAllHidden', 'soloActive'];

const missingKeys = requiredLocaleKeys.filter((key) => typeof layerLocale?.[key] !== 'string');
if (missingKeys.length > 0) {
  console.error(`Missing layer stack panel locale keys: ${missingKeys.join(', ')}`);
  process.exit(1);
}

const missingActionKeys = requiredActionLocaleKeys.filter((key) => typeof layerLocale?.actions?.[key] !== 'string');
if (missingActionKeys.length > 0) {
  console.error(`Missing layer stack panel action locale keys: ${missingActionKeys.join(', ')}`);
  process.exit(1);
}

const source = readFileSync('src/components/panel/right/LayerStackPanel.tsx', 'utf8');
for (const marker of [
  'data-testid="layer-stack-composition-summary"',
  'data-testid="layer-stack-count-summary"',
  'data-testid="layer-hidden-count"',
  'data-testid="layer-active-action-strip"',
  'data-testid="layer-active-solo"',
  'data-testid="layer-show-all-hidden"',
  'data-testid="layer-icon-action-row"',
  'data-visible-layer-count={visibleLayerCount}',
  'data-hidden-layer-count={hiddenLayerCount}',
  'data-solo-active={String(isActiveLayerSoloed)}',
  'data-group-count={groupCount}',
  'editor.layers.hiddenLayerCount',
  'editor.layers.groupSummaryCount',
  'editor.layers.actions.soloActive',
  'editor.layers.actions.showAllHidden',
]) {
  if (!source.includes(marker)) {
    console.error(`Layer stack panel missing count summary marker: ${marker}`);
    process.exit(1);
  }
}

console.log('layer stack panel UI ok');

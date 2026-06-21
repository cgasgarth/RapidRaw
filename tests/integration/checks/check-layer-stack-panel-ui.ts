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
const requiredExportReadinessLocaleKeys = ['summary', 'title'];
const requiredOperationReadinessLocaleKeys = [
  'groupBlocked',
  'groupReady',
  'moveBlocked',
  'moveReady',
  'ungroupBlocked',
  'ungroupReady',
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

const missingExportReadinessKeys = requiredExportReadinessLocaleKeys.filter(
  (key) => typeof layerLocale?.exportReadiness?.[key] !== 'string',
);
if (missingExportReadinessKeys.length > 0) {
  console.error(`Missing layer export readiness locale keys: ${missingExportReadinessKeys.join(', ')}`);
  process.exit(1);
}

const missingOperationReadinessKeys = requiredOperationReadinessLocaleKeys.filter(
  (key) => typeof layerLocale?.operationReadiness?.[key] !== 'string',
);
if (missingOperationReadinessKeys.length > 0) {
  console.error(`Missing layer operation readiness locale keys: ${missingOperationReadinessKeys.join(', ')}`);
  process.exit(1);
}

const source = readFileSync('src/components/panel/right/LayerStackPanel.tsx', 'utf8');
for (const marker of [
  'data-testid="layer-stack-composition-summary"',
  'data-testid="layer-stack-count-summary"',
  'data-testid="layer-hidden-count"',
  'data-testid="layer-active-action-strip"',
  'data-testid="layer-export-readiness-summary"',
  'data-testid="layer-operation-readiness-summary"',
  'data-testid="layer-operation-move-ready"',
  'data-testid="layer-operation-group-ready"',
  'data-testid="layer-operation-ungroup-ready"',
  'data-testid="layer-active-solo"',
  'data-testid="layer-show-all-hidden"',
  'data-testid="layer-icon-action-row"',
  'data-exportable-layer-count={exportReadiness.exportableLayerCount}',
  'data-masked-layer-count={exportReadiness.maskedLayerCount}',
  'buildLayerExportReadinessSummary(masks)',
  'data-visible-layer-count={visibleLayerCount}',
  'data-hidden-layer-count={hiddenLayerCount}',
  'data-solo-active={String(isActiveLayerSoloed)}',
  'data-can-move-active-layer={String(canMoveActiveLayerUp || canMoveActiveLayerDown)}',
  'data-can-group-active-layer={String(canGroupActiveLayer)}',
  'data-can-ungroup-active-layer={String(canUngroupActiveLayer)}',
  'data-group-count={groupCount}',
  'editor.layers.exportReadiness.title',
  'editor.layers.exportReadiness.summary',
  'editor.layers.hiddenLayerCount',
  'editor.layers.groupSummaryCount',
  'editor.layers.actions.soloActive',
  'editor.layers.actions.showAllHidden',
  'editor.layers.operationReadiness.moveReady',
  'editor.layers.operationReadiness.groupReady',
  'editor.layers.operationReadiness.ungroupReady',
]) {
  if (!source.includes(marker)) {
    console.error(`Layer stack panel missing count summary marker: ${marker}`);
    process.exit(1);
  }
}

console.log('layer stack panel UI ok');

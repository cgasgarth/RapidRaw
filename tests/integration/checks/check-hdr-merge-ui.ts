#!/usr/bin/env bun

import { readFileSync } from 'node:fs';

import { DEFAULT_HDR_MERGE_UI_SETTINGS, hdrMergeUiSettingsSchema } from '../../../src/schemas/hdrMergeUiSchemas.ts';

const requiredLocaleKeys = [
  'alignment.auto',
  'alignment.homography',
  'alignment.none',
  'alignment.translation',
  'alignmentLabel',
  'apiPending',
  'bracketValidation.required',
  'bracketValidation.warn',
  'bracketValidationLabel',
  'deghosting.high',
  'deghosting.low',
  'deghosting.medium',
  'deghosting.off',
  'deghostingLabel',
  'previewBudgetLabel',
  'previewPixels',
  'quality.balanced',
  'quality.best',
  'quality.preview',
  'qualityLabel',
  'sourceCountBlocked',
  'strategy.exposureFusion',
  'strategy.sceneLinear',
  'strategyLabel',
  'summaryAlignment',
  'summaryDeghosting',
  'summaryPreviewBudget',
  'summaryQuality',
  'summarySources',
  'toneMapPreview',
  'uiOnlyNotice',
  'workflowStatus',
  'workflowTitle',
];

const getValue = (root, path) =>
  path.split('.').reduce((value, segment) => (value && typeof value === 'object' ? value[segment] : undefined), root);

const locale = JSON.parse(readFileSync('src/i18n/locales/en.json', 'utf8'));
const missingKeys = requiredLocaleKeys.filter((key) => typeof getValue(locale.modals?.hdr, key) !== 'string');
if (missingKeys.length > 0) {
  console.error(`Missing HDR UI locale keys: ${missingKeys.join(', ')}`);
  process.exit(1);
}

const valid = hdrMergeUiSettingsSchema.safeParse(DEFAULT_HDR_MERGE_UI_SETTINGS);
if (!valid.success) {
  console.error(valid.error.message);
  process.exit(1);
}

const invalid = hdrMergeUiSettingsSchema.safeParse({
  ...DEFAULT_HDR_MERGE_UI_SETTINGS,
  maxPreviewDimensionPx: 16_384,
});
if (invalid.success) {
  console.error('HDR UI schema accepted an oversized preview budget.');
  process.exit(1);
}

const source = readFileSync('src/components/modals/HdrModal.tsx', 'utf8');
for (const marker of [
  'hdr-setup-summary',
  'hdr-setup-summary-chip',
  'modals.hdr.summarySources',
  'modals.hdr.strategyLabel',
  'modals.hdr.summaryAlignment',
  'settings.maxPreviewDimensionPx',
]) {
  if (!source.includes(marker)) {
    console.error(`HDR modal missing setup summary marker: ${marker}`);
    process.exit(1);
  }
}

console.log('hdr merge UI ok');

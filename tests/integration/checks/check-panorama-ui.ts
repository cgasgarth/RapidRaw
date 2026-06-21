#!/usr/bin/env bun

import { readFileSync } from 'node:fs';

import { DEFAULT_PANORAMA_UI_SETTINGS, panoramaUiSettingsSchema } from '../../../src/schemas/panoramaUiSchemas.ts';

const requiredLocaleKeys = [
  'apiPending',
  'blend.feather.label',
  'blend.feather.status',
  'blend.multi_band.label',
  'blend.multi_band.status',
  'blendLabel',
  'boundary.autoCrop',
  'boundary.manualCrop',
  'boundary.transparent',
  'boundaryLabel',
  'exposure.gainCompensation',
  'exposure.none',
  'exposureLabel',
  'previewBudgetLabel',
  'previewPixels',
  'previewWorkload',
  'projection.cylindrical',
  'projection.rectilinear',
  'projection.spherical',
  'projectionLabel',
  'quality.balanced',
  'quality.best',
  'quality.preview',
  'qualityLabel',
  'sourceCountBlocked',
  'summaryBlend',
  'summaryBoundary',
  'summaryExposure',
  'summaryPreviewBudget',
  'summaryProjection',
  'summaryQuality',
  'summarySources',
  'summaryWorkload',
  'uiOnlyNotice',
  'workflowStatus',
  'workflowTitle',
];

const readJson = (path) => JSON.parse(readFileSync(path, 'utf8'));

const getValue = (root, path) =>
  path.split('.').reduce((value, segment) => (value && typeof value === 'object' ? value[segment] : undefined), root);

const locale = readJson('src/i18n/locales/en.json');
const panoramaLocale = locale.modals?.panorama;
const missingKeys = requiredLocaleKeys.filter((key) => typeof getValue(panoramaLocale, key) !== 'string');

if (missingKeys.length > 0) {
  console.error(`Missing panorama UI locale keys: ${missingKeys.join(', ')}`);
  process.exit(1);
}

const valid = panoramaUiSettingsSchema.safeParse(DEFAULT_PANORAMA_UI_SETTINGS);
if (!valid.success) {
  console.error(valid.error.message);
  process.exit(1);
}

const invalid = panoramaUiSettingsSchema.safeParse({
  ...DEFAULT_PANORAMA_UI_SETTINGS,
  maxPreviewDimensionPx: 16_384,
});
if (invalid.success) {
  console.error('Panorama UI schema accepted an oversized preview budget.');
  process.exit(1);
}

const source = readFileSync('src/components/modals/PanoramaModal.tsx', 'utf8');
for (const marker of [
  'panorama-setup-summary',
  'panorama-setup-summary-chip',
  'data-estimated-preview-megapixels={estimatedPreviewMegapixels}',
  'data-preview-source-count={imageCount ?? 0}',
  'modals.panorama.previewWorkload',
  'modals.panorama.summaryProjection',
  'modals.panorama.summarySources',
  'modals.panorama.summaryWorkload',
  'settings.maxPreviewDimensionPx',
]) {
  if (!source.includes(marker)) {
    console.error(`Panorama modal missing setup summary marker: ${marker}`);
    process.exit(1);
  }
}

console.log('panorama UI ok');

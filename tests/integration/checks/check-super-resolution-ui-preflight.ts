#!/usr/bin/env bun

import { readFileSync } from 'node:fs';

const locale = JSON.parse(readFileSync('src/i18n/locales/en.json', 'utf8'));
const srLocale = locale.modals?.superResolution;
const requiredLocaleKeys = [
  'preflight.sources',
  'preflight.scale',
  'preflight.outputPixels',
  'preflight.workload',
  'previewWorkloadValue',
  'previewMemoryValue',
  'preflight.alignment',
  'preflight.detail',
  'qualityBalanced',
  'qualityBest',
  'qualityLabel',
  'qualityPreview',
];

const getValue = (root, path) =>
  path.split('.').reduce((value, segment) => (value && typeof value === 'object' ? value[segment] : undefined), root);

const missingKeys = requiredLocaleKeys.filter((key) => typeof getValue(srLocale, key) !== 'string');
if (missingKeys.length > 0) {
  console.error(`Missing super-resolution preflight locale keys: ${missingKeys.join(', ')}`);
  process.exit(1);
}

const source = readFileSync('src/components/modals/SuperResolutionModal.tsx', 'utf8');
for (const marker of [
  'modals.superResolution.qualityLabel',
  'settings.qualityPreference',
  'qualityOptions.find',
  'ComputationalSetupStatusLine',
  'estimatedPreviewMemoryMb',
  'data-estimated-preview-memory-mb={estimatedPreviewMemoryMb}',
  'data-estimated-preview-megapixels={estimatedPreviewMegapixels}',
  'modals.superResolution.preflight.memory',
  'modals.superResolution.previewMemoryValue',
  'modals.superResolution.preflight.workload',
  'modals.superResolution.previewWorkloadValue',
]) {
  if (!source.includes(marker)) {
    console.error(`Super-resolution preflight missing marker: ${marker}`);
    process.exit(1);
  }
}

console.log('super-resolution UI preflight ok');

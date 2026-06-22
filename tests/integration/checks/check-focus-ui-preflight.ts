#!/usr/bin/env bun

import { readFileSync } from 'node:fs';

const locale = JSON.parse(readFileSync('src/i18n/locales/en.json', 'utf8'));
const focusLocale = locale.modals?.focusStack;
const requiredLocaleKeys = [
  'preflight.sources',
  'preflight.alignment',
  'preflight.blend',
  'preflight.retouch',
  'preflight.workload',
  'preflight.memory',
  'haloSuppressionLabel',
  'haloSuppressionOff',
  'haloSuppressionOn',
  'haloSuppressionValue',
  'previewMemoryValue',
  'previewWorkloadValue',
  'qualityBalanced',
  'qualityBest',
  'qualityLabel',
  'qualityPreview',
];

const getValue = (root, path) =>
  path.split('.').reduce((value, segment) => (value && typeof value === 'object' ? value[segment] : undefined), root);

const missingKeys = requiredLocaleKeys.filter((key) => typeof getValue(focusLocale, key) !== 'string');
if (missingKeys.length > 0) {
  console.error(`Missing focus preflight locale keys: ${missingKeys.join(', ')}`);
  process.exit(1);
}

const source = readFileSync('src/components/modals/FocusStackModal.tsx', 'utf8');
for (const marker of [
  'modals.focusStack.qualityLabel',
  'settings.qualityPreference',
  'qualityOptions.find',
  'ComputationalSetupStatusLine',
  'estimatedPreviewMemoryMb',
  'data-estimated-preview-memory-mb={estimatedPreviewMemoryMb}',
  'data-estimated-preview-megapixels={estimatedPreviewMegapixels}',
  'modals.focusStack.preflight.memory',
  'modals.focusStack.previewMemoryValue',
  'data-preview-source-count={sourceCount}',
  'modals.focusStack.preflight.workload',
  'modals.focusStack.previewWorkloadValue',
  'focus-halo-suppression-controls',
  'data-halo-suppression-strength-percent={settings.haloSuppressionStrengthPercent}',
  'data-halo-risk-cell-ratio={outputReview.haloRiskCellRatio}',
]) {
  if (!source.includes(marker)) {
    console.error(`Focus preflight missing marker: ${marker}`);
    process.exit(1);
  }
}

console.log('focus UI preflight ok');

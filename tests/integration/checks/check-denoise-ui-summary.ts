#!/usr/bin/env bun

import { readFileSync } from 'node:fs';

const locale = JSON.parse(readFileSync('src/i18n/locales/en.json', 'utf8'));
const denoiseLocale = locale.modals?.denoise;
const requiredLocaleKeys = [
  'emptyTarget',
  'methodAiDescription',
  'methodBm3dDescription',
  'setupPreview',
  'setupPreviewAlt',
  'setupPreviewCount_one',
  'setupPreviewCount_other',
  'summaryBatch',
  'summaryIntensity',
  'summaryIntensityValue',
  'summaryMethod',
  'summaryRaster',
  'summaryRaw',
  'summarySingle',
  'summarySourceCount_one',
  'summarySourceCount_other',
  'summarySourceFormat',
  'summarySourceMode',
  'summarySources',
  'summaryWorkload',
  'summaryWorkloadValue_one',
  'summaryWorkloadValue_other',
];

const missingKeys = requiredLocaleKeys.filter((key) => typeof denoiseLocale?.[key] !== 'string');
if (missingKeys.length > 0) {
  console.error(`Missing denoise summary locale keys: ${missingKeys.join(', ')}`);
  process.exit(1);
}

const source = readFileSync('src/components/modals/DenoiseModal.tsx', 'utf8');
for (const marker of [
  'data-testid="denoise-setup-summary"',
  'modals.denoise.summaryMethod',
  'modals.denoise.summaryIntensity',
  'modals.denoise.summarySourceFormat',
  'modals.denoise.summaryWorkload',
  'data-denoise-source-count={denoiseSourceCount}',
  'const denoiseSourceCount = targetPaths.length',
  'data-testid="denoise-empty-target-guard"',
  'data-testid="denoise-setup-preview"',
  'data-denoise-preview-source-count={denoiseSourceCount}',
  'modals.denoise.setupPreview',
  'modals.denoise.setupPreviewCount',
  'disabled={!canRunDenoise}',
  'modals.denoise.emptyTarget',
  'data-denoise-method={method}',
  'data-denoise-method-guidance={method}',
  'selectedMethodDescription',
  'modals.denoise.methodAiDescription',
  'modals.denoise.methodBm3dDescription',
  'selectedMethodLabel',
]) {
  if (!source.includes(marker)) {
    console.error(`Denoise modal missing setup summary marker: ${marker}`);
    process.exit(1);
  }
}

console.log('denoise UI summary ok');

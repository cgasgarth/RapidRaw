#!/usr/bin/env bun

import { readFileSync } from 'node:fs';

const locale = JSON.parse(readFileSync('src/i18n/locales/en.json', 'utf8'));
const denoiseLocale = locale.modals?.denoise;
const requiredLocaleKeys = [
  'emptyTarget',
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
  'disabled={!canRunDenoise}',
  'modals.denoise.emptyTarget',
  'data-denoise-method={method}',
  'selectedMethodLabel',
]) {
  if (!source.includes(marker)) {
    console.error(`Denoise modal missing setup summary marker: ${marker}`);
    process.exit(1);
  }
}

console.log('denoise UI summary ok');

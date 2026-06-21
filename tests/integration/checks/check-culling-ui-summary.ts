#!/usr/bin/env bun

import { readFileSync } from 'node:fs';

const locale = JSON.parse(readFileSync('src/i18n/locales/en.json', 'utf8'));
const cullingLocale = locale.modals?.culling;
const requiredLocaleKeys = [
  'summaryBlur',
  'summaryDisabled',
  'summaryEnabledThreshold',
  'summarySimilar',
  'summarySourceCount_one',
  'summarySourceCount_other',
  'summarySources',
  'summaryWorkload',
  'summaryWorkloadValue_one',
  'summaryWorkloadValue_other',
];

const missingKeys = requiredLocaleKeys.filter((key) => typeof cullingLocale?.[key] !== 'string');
if (missingKeys.length > 0) {
  console.error(`Missing culling summary locale keys: ${missingKeys.join(', ')}`);
  process.exit(1);
}

const source = readFileSync('src/components/modals/CullingModal.tsx', 'utf8');
for (const marker of [
  'data-testid="culling-setup-summary"',
  'data-image-count={imagePaths.length}',
  'data-group-similar-enabled={String(settings.groupSimilar)}',
  'data-blur-filter-enabled={String(settings.filterBlurry)}',
  'modals.culling.summaryWorkload',
  'modals.culling.summaryWorkloadValue',
]) {
  if (!source.includes(marker)) {
    console.error(`Culling setup summary missing marker: ${marker}`);
    process.exit(1);
  }
}

console.log('culling UI summary ok');

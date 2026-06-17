#!/usr/bin/env bun

import { readFileSync, readdirSync } from 'node:fs';

const requiredFiles = [
  'src/components/modals/ComputationalMergeReviewPanel.tsx',
  'src/components/modals/PanoramaModal.tsx',
  'src/components/modals/FocusStackModal.tsx',
  'src/components/modals/SuperResolutionModal.tsx',
];

const failures: string[] = [];
for (const file of requiredFiles) {
  const source = readFileSync(file, 'utf8');
  if (!source.includes('ComputationalMergeReviewPanel')) {
    failures.push(`${file}: missing ComputationalMergeReviewPanel reference.`);
  }
}

for (const file of readdirSync('src/i18n/locales').filter((name) => name.endsWith('.json'))) {
  const locale = JSON.parse(readFileSync(`src/i18n/locales/${file}`, 'utf8'));
  for (const family of ['focusStack', 'panorama', 'superResolution'] as const) {
    const review = locale.modals?.[family]?.review;
    if (review === undefined) {
      failures.push(`${file}: missing ${family}.review keys.`);
      continue;
    }
    for (const key of ['title', 'proofStatus', 'limitation', 'runtimeBridge', 'privateRawPending', 'uiE2ePending']) {
      if (typeof review[key] !== 'string' || review[key].length === 0) {
        failures.push(`${file}: ${family}.review.${key} must be a non-empty string.`);
      }
    }
  }
}

const panelSource = readFileSync('src/components/modals/ComputationalMergeReviewPanel.tsx', 'utf8');
for (const marker of ['ready', 'review', 'pending']) {
  if (!panelSource.includes(marker)) {
    failures.push(`review panel must render ${marker} status.`);
  }
}

if (failures.length > 0) {
  console.error('Computational merge review panel validation failed.');
  console.error(failures.join('\n'));
  process.exit(1);
}

console.log('computational merge review panels ok');

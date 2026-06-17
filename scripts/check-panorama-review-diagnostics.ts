#!/usr/bin/env bun

import { readFileSync } from 'node:fs';

const failures: string[] = [];
const modalSource = readFileSync('src/components/modals/PanoramaModal.tsx', 'utf8');
const panelSource = readFileSync('src/components/modals/ComputationalMergeReviewPanel.tsx', 'utf8');
const contractSource = readFileSync('src/utils/computationalMergeReviewPanels.ts', 'utf8');

for (const marker of [
  'panorama-review-diagnostics',
  'sections={[',
  'modals.panorama.projectionLabel',
  'modals.panorama.boundaryLabel',
  'modals.panorama.exposureLabel',
  'modals.panorama.previewBudgetLabel',
  'modals.panorama.review.privateRawPending',
  'modals.panorama.review.uiE2ePending',
]) {
  if (!modalSource.includes(marker)) {
    failures.push(`Panorama review diagnostics missing ${marker}.`);
  }
}

for (const marker of ['ComputationalMergeReviewSection', 'sections?:', 'data-testid={testId}']) {
  if (!panelSource.includes(marker)) {
    failures.push(`Shared review panel missing ${marker}.`);
  }
}

for (const marker of ['panorama_stitch', 'synthetic_runtime', 'not_raw_decode_verified', 'not_ui_e2e_verified']) {
  if (!contractSource.includes(marker)) {
    failures.push(`Review diagnostics contract missing ${marker}.`);
  }
}

if (failures.length > 0) {
  console.error('Panorama review diagnostics validation failed.');
  console.error(failures.join('\n'));
  process.exit(1);
}

console.log('panorama review diagnostics ok');

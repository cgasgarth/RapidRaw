#!/usr/bin/env bun

import { readFileSync } from 'node:fs';

const failures: string[] = [];
const modalSource = readFileSync('src/components/modals/SuperResolutionModal.tsx', 'utf8');
const panelSource = readFileSync('src/components/modals/ComputationalMergeReviewPanel.tsx', 'utf8');
const contractSource = readFileSync('src/utils/computationalMergeReviewPanels.ts', 'utf8');

for (const marker of [
  'sr-review-diagnostics',
  'sr-output-scale-summary',
  'sr-readiness-summary',
  'data-reconstruction-ready={String(isSourceCountValid)}',
  'data-alignment-mode={settings.alignmentMode}',
  'data-detail-policy={settings.detailPolicy}',
  'outputPixelMultiplier',
  'sourceReadinessLabel',
  'reconstructionReadinessLabel',
  'sections={[',
  'modals.superResolution.preflight.sources',
  'modals.superResolution.preflight.ready',
  'modals.superResolution.preflight.blocked',
  'modals.superResolution.preflight.scale',
  'modals.superResolution.preflight.outputPixels',
  'modals.superResolution.outputPixelMultiplier',
  'outputPixelMultiplier = Number((settings.outputScale * settings.outputScale).toFixed(2))',
  'modals.superResolution.preflight.alignment',
  'modals.superResolution.qualityLabel',
  'modals.superResolution.review.detailGain',
  'modals.superResolution.review.privateRawPending',
]) {
  if (!modalSource.includes(marker)) {
    failures.push(`SR review diagnostics missing ${marker}.`);
  }
}

for (const marker of ['ComputationalMergeReviewSection', 'sections?:', 'data-testid={testId}']) {
  if (!panelSource.includes(marker)) {
    failures.push(`Shared review panel missing ${marker}.`);
  }
}

for (const marker of [
  'super_resolution',
  'superResolutionDetailGainRatio',
  'synthetic_runtime',
  'not_raw_decode_verified',
]) {
  if (!contractSource.includes(marker)) {
    failures.push(`Review diagnostics contract missing ${marker}.`);
  }
}

if (failures.length > 0) {
  console.error('SR review diagnostics validation failed.');
  console.error(failures.join('\n'));
  process.exit(1);
}

console.log('SR review diagnostics ok');

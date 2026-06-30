#!/usr/bin/env bun

import { readFileSync } from 'node:fs';

const failures: string[] = [];
const modalSource = readFileSync('src/components/modals/computational-merge/PanoramaModal.tsx', 'utf8');
const panelSource = readFileSync('src/components/modals/computational-merge/ComputationalMergeReviewPanel.tsx', 'utf8');
const contractSource = readFileSync('src/utils/computational-merge/computationalMergeReviewPanels.ts', 'utf8');
const mergeStatusSource = readFileSync('src/components/modals/computational-merge/MergeStatusViews.tsx', 'utf8');

for (const marker of [
  'panorama-review-diagnostics',
  'panorama-stitch-readiness-summary',
  'panorama-stitch-readiness-chip',
  'data-engine-apply-ready={String(isEngineApplyReady)}',
  'data-stitch-ready={String(isEngineApplyReady)}',
  'data-exposure-mode={settings.exposureMode}',
  'data-boundary-mode={settings.boundaryMode}',
  'panorama-engine-capability-blocker',
  'panorama-projection-option-${option.value}',
  'panorama-boundary-option-${option.value}',
  'stitchReadinessLabel',
  'sections={[',
  'sourceReadinessLabel',
  'modals.panorama.summarySourceCount',
  'modals.panorama.summaryReady',
  'modals.panorama.summaryBlocked',
  'modals.panorama.projectionLabel',
  'modals.panorama.boundaryLabel',
  'modals.panorama.exposureLabel',
  'modals.panorama.previewBudgetLabel',
  'modals.panorama.review.limitation',
  'modals.panorama.review.runtimeAutoCrop',
  'modals.panorama.review.engineCapabilityBlocked',
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

for (const marker of [
  'data-testid="merge-start-action"',
  'data-start-blocked={String(isStartBlocked)}',
  'disabled:bg-bg-secondary disabled:text-text-tertiary disabled:ring-1 disabled:ring-border-color',
]) {
  if (!mergeStatusSource.includes(marker)) {
    failures.push(`Shared merge footer missing blocked start marker: ${marker}.`);
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

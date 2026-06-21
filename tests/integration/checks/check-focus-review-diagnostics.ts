#!/usr/bin/env bun

import { readFileSync } from 'node:fs';

const failures: string[] = [];
const modalSource = readFileSync('src/components/modals/FocusStackModal.tsx', 'utf8');
const panelSource = readFileSync('src/components/modals/ComputationalMergeReviewPanel.tsx', 'utf8');
const contractSource = readFileSync('src/utils/computationalMergeReviewPanels.ts', 'utf8');

for (const marker of [
  'focus-review-diagnostics',
  'focus-stack-setup-summary',
  'focus-stack-readiness-summary',
  'data-stack-ready={String(isSourceCountValid)}',
  'data-alignment-mode={settings.alignmentMode}',
  'data-blend-method={settings.blendMethod}',
  'sourceReadinessLabel',
  'stackReadinessLabel',
  'sections={[',
  'modals.focusStack.preflight.sources',
  'modals.focusStack.preflight.ready',
  'modals.focusStack.preflight.blocked',
  'modals.focusStack.preflight.alignment',
  'modals.focusStack.qualityLabel',
  'modals.focusStack.preflight.previewBudget',
  'settings.maxPreviewDimensionPx',
  'modals.focusStack.preflight.blend',
  'modals.focusStack.review.decision',
  'modals.focusStack.review.editableArtifact',
  'modals.focusStack.review.haloRiskCells',
  'modals.focusStack.review.lowConfidenceCells',
  'modals.focusStack.review.overlay',
  'modals.focusStack.review.overlayMode',
  'modals.focusStack.review.overlayTitle',
  'modals.focusStack.review.sourceContribution',
  'modals.focusStack.review.percentValue',
  'modals.focusStack.review.provenance',
  'modals.focusStack.review.sharpnessCoverage',
  'modals.focusStack.review.transitionRisk',
  'modals.focusStack.review.warning',
  'buildFocusStackOutputReviewWorkflow',
  'focus-sharpness-overlay-controls',
  'settings.reviewOverlayMode',
  'settings.reviewOverlayOpacityPercent',
]) {
  if (!modalSource.includes(marker)) {
    failures.push(`Focus review diagnostics missing ${marker}.`);
  }
}

for (const marker of ['ComputationalMergeReviewSection', 'sections?:', 'data-testid={testId}']) {
  if (!panelSource.includes(marker)) {
    failures.push(`Shared review panel missing ${marker}.`);
  }
}

for (const marker of ['focus_stack', 'sharpnessGainRatio', 'synthetic_runtime', 'not_raw_decode_verified']) {
  if (!contractSource.includes(marker)) {
    failures.push(`Review diagnostics contract missing ${marker}.`);
  }
}

if (failures.length > 0) {
  console.error('Focus review diagnostics validation failed.');
  console.error(failures.join('\n'));
  process.exit(1);
}

console.log('focus review diagnostics ok');

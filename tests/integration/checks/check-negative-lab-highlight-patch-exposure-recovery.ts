#!/usr/bin/env bun

import { readFileSync } from 'node:fs';

import { negativeLabHighlightPatchExposureSuggestionSchema } from '../../../src/schemas/negativeLabHighlightPatchExposureSuggestionSchemas.ts';

const suggestion = negativeLabHighlightPatchExposureSuggestionSchema.parse({
  applicationRisk: 'low',
  applyAllowed: true,
  correctionMagnitudeEv: 0.35,
  currentFrameClippedFraction: 0.08,
  currentFrameExposureOffset: 0.5,
  currentSampleClippedFraction: 0.42,
  currentSampleP99MaxChannel: 1,
  currentSampleRgb: [0.99, 0.97, 0.95],
  effectiveExposure: 0.1,
  offsetClamped: false,
  projectedFrameClippedFraction: 0.04,
  projectedSampleClippedFraction: 0,
  projectedSampleP99MaxChannel: 0.97,
  projectedSampleRgb: [0.91, 0.89, 0.86],
  role: 'highlight',
  sampleRect: { height: 0.16, width: 0.16, x: 0.66, y: 0.18 },
  status: 'suggested',
  suggestedExposureDeltaEv: -0.35,
  suggestedFrameExposureOffset: 0.15,
});

if (
  suggestion.role !== 'highlight' ||
  suggestion.status !== 'suggested' ||
  suggestion.suggestedFrameExposureOffset !== 0.15 ||
  suggestion.effectiveExposure !== 0.1 ||
  !suggestion.applyAllowed
) {
  throw new Error('Negative Lab highlight recovery schema changed expected apply semantics.');
}

for (const invalidSuggestion of [
  { ...suggestion, role: 'shadow' },
  { ...suggestion, status: 'unsafe' },
  { ...suggestion, suggestedExposureDeltaEv: 0.05 },
  { ...suggestion, projectedSampleP99MaxChannel: 1.2 },
]) {
  const acceptedInvalidSuggestion = (() => {
    try {
      negativeLabHighlightPatchExposureSuggestionSchema.parse(invalidSuggestion);
      return true;
    } catch {
      return false;
    }
  })();

  if (acceptedInvalidSuggestion) {
    throw new Error('Negative Lab highlight recovery schema accepted an invalid payload.');
  }
}

const modalSource = readFileSync('src/components/modals/NegativeConversionModal.tsx', 'utf8');
const visualSource = readFileSync('src/validation/visual/main.tsx', 'utf8');
const smokeSource = readFileSync('scripts/proofs/capture-visual-smoke.ts', 'utf8');
const proofSource = readFileSync('scripts/lib/proofs/visual-smoke-proofs.ts', 'utf8');
const rustSource = readFileSync('src-tauri/src/negative_conversion.rs', 'utf8');
const libSource = readFileSync('src-tauri/src/lib.rs', 'utf8');

for (const marker of [
  'SuggestNegativeLabHighlightPatchExposure',
  'negative-lab-analyze-highlight-recovery',
  'negative-lab-highlight-recovery-suggestion',
  'negative-lab-highlight-recovery-offset',
  'negative-lab-apply-highlight-recovery',
  'handleApplyHighlightPatchExposureSuggestion',
  'handleFrameExposureOffsetChange(',
  'negativeLabHighlightPatchExposureSuggestionSchema',
]) {
  if (!modalSource.includes(marker) && !visualSource.includes(marker)) {
    throw new Error(`Negative Lab highlight recovery UI marker missing: ${marker}`);
  }
}

for (const marker of [
  'suggest_negative_lab_highlight_patch_exposure',
  'build_negative_lab_highlight_patch_exposure_suggestion',
  'negative_lab_highlight_patch_metrics',
  'NEGATIVE_LAB_HIGHLIGHT_CLIPPING_CEILING',
  'suggested_frame_exposure_offset',
]) {
  if (!rustSource.includes(marker) || !libSource.includes('suggest_negative_lab_highlight_patch_exposure')) {
    throw new Error(`Negative Lab highlight recovery runtime marker missing: ${marker}`);
  }
}

for (const marker of [
  'negative-lab-patch-probe-highlight-patch',
  'negative-lab-highlight-recovery-suggestion',
  'suggest_negative_lab_highlight_patch_exposure',
  'currentFrameExposureOffset: z.literal(0.5)',
  'effectiveExposure: z.literal(0.1)',
  'exposureOffset: z.literal(0.15)',
]) {
  if (!smokeSource.includes(marker) && !proofSource.includes(marker)) {
    throw new Error(`Negative Lab highlight recovery smoke proof marker missing: ${marker}`);
  }
}

console.log('negative lab highlight patch exposure recovery ok');

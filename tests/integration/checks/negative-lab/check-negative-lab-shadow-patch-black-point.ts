#!/usr/bin/env bun

import { readFileSync } from 'node:fs';

import { negativeLabShadowPatchBlackPointSuggestionSchema } from '../../../../src/schemas/negative-lab/negativeLabShadowPatchBlackPointSuggestionSchemas.ts';

const suggestion = negativeLabShadowPatchBlackPointSuggestionSchema.parse({
  applicationRisk: 'low',
  applyAllowed: true,
  correctionMagnitude: 0.12,
  currentBlackPoint: 0,
  currentSampleP01MinChannel: 0.12,
  currentSampleRgb: [0.14, 0.13, 0.12],
  endpointClamped: false,
  projectedBlackPoint: 0.12,
  projectedSampleP01MinChannel: 0.034,
  projectedSampleRgb: [0.06, 0.05, 0.04],
  role: 'shadow',
  sampleRect: { height: 0.18, width: 0.18, x: 0.18, y: 0.62 },
  status: 'suggested',
  suggestedBlackPointDelta: 0.12,
});

if (
  suggestion.role !== 'shadow' ||
  suggestion.status !== 'suggested' ||
  suggestion.projectedBlackPoint !== 0.12 ||
  suggestion.suggestedBlackPointDelta !== 0.12 ||
  !suggestion.applyAllowed
) {
  throw new Error('Negative Lab shadow black-point schema changed expected apply semantics.');
}

for (const invalidSuggestion of [
  { ...suggestion, role: 'highlight' },
  { ...suggestion, status: 'unsafe' },
  { ...suggestion, suggestedBlackPointDelta: -0.01 },
  { ...suggestion, projectedSampleP01MinChannel: 1.2 },
]) {
  const acceptedInvalidSuggestion = (() => {
    try {
      negativeLabShadowPatchBlackPointSuggestionSchema.parse(invalidSuggestion);
      return true;
    } catch {
      return false;
    }
  })();

  if (acceptedInvalidSuggestion) {
    throw new Error('Negative Lab shadow black-point schema accepted an invalid payload.');
  }
}

const modalSource = readFileSync('src/components/modals/negative-lab/NegativeConversionModal.tsx', 'utf8');
const visualSource = readFileSync('src/validation/visual/main.tsx', 'utf8');
const smokeSource = readFileSync('scripts/proofs/capture-visual-smoke.ts', 'utf8');
const proofSource = readFileSync('scripts/lib/proofs/visual-smoke-proofs.ts', 'utf8');
const rustSource = readFileSync('src-tauri/src/negative_conversion.rs', 'utf8');
const libSource = readFileSync('src-tauri/src/lib.rs', 'utf8');

for (const marker of [
  'SuggestNegativeLabShadowPatchBlackPoint',
  'negative-lab-analyze-shadow-black-point',
  'negative-lab-shadow-black-point-suggestion',
  'negative-lab-shadow-black-point-value',
  'negative-lab-apply-shadow-black-point',
  'handleApplyShadowPatchBlackPointSuggestion',
  'negativeLabShadowPatchBlackPointSuggestionSchema',
]) {
  if (!modalSource.includes(marker) && !visualSource.includes(marker)) {
    throw new Error(`Negative Lab shadow black-point UI marker missing: ${marker}`);
  }
}

for (const marker of [
  'suggest_negative_lab_shadow_patch_black_point',
  'build_negative_lab_shadow_patch_black_point_suggestion',
  'negative_lab_shadow_patch_metrics',
  'NEGATIVE_LAB_SHADOW_TARGET_FLOOR',
  'suggested_black_point_delta',
]) {
  if (!rustSource.includes(marker) || !libSource.includes('suggest_negative_lab_shadow_patch_black_point')) {
    throw new Error(`Negative Lab shadow black-point runtime marker missing: ${marker}`);
  }
}

for (const marker of [
  'negative-lab-patch-probe-shadow-patch',
  'negative-lab-shadow-black-point-suggestion',
  'suggest_negative_lab_shadow_patch_black_point',
  'black_point":0.12',
]) {
  if (!smokeSource.includes(marker) && !proofSource.includes(marker)) {
    throw new Error(`Negative Lab shadow black-point smoke proof marker missing: ${marker}`);
  }
}

console.log('negative lab shadow patch black point ok');

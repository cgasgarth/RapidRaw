#!/usr/bin/env bun

import { readFileSync } from 'node:fs';

import { negativeLabNeutralPatchSuggestionSchema } from '../../../src/schemas/negativeLabNeutralPatchSuggestionSchemas.ts';

const suggestion = negativeLabNeutralPatchSuggestionSchema.parse({
  applicationRisk: 'low',
  applyAllowed: true,
  confidence: 0.82,
  correctionMagnitude: 0.07,
  effectiveRgbBalance: { blueWeight: 1.16, greenWeight: 0.93, redWeight: 1.14 },
  neutralityRisk: 'high',
  offsetClamped: false,
  sampleDensity: [0.145, 0.238, 0.356],
  sampleRect: { height: 0.18, width: 0.18, x: 0.18, y: 0.62 },
  sampleRgb: [0.716, 0.578, 0.441],
  suggestedRgbBalanceOffset: { blueWeight: -0.02, greenWeight: -0.03, redWeight: 0.07 },
});

if (
  suggestion.suggestedRgbBalanceOffset.redWeight !== 0.07 ||
  suggestion.effectiveRgbBalance.greenWeight !== 0.93 ||
  suggestion.neutralityRisk !== 'high' ||
  suggestion.applicationRisk !== 'low' ||
  suggestion.correctionMagnitude !== 0.07 ||
  !suggestion.applyAllowed
) {
  throw new Error('Negative Lab neutral patch RGB suggestion schema changed expected payload semantics.');
}

for (const invalidSuggestion of [
  { ...suggestion, neutralityRisk: 'severe' },
  { ...suggestion, applicationRisk: 'severe' },
  { ...suggestion, correctionMagnitude: -0.01 },
  { ...suggestion, suggestedRgbBalanceOffset: { blueWeight: -0.021, greenWeight: -0.03, redWeight: 0.07 } },
]) {
  const acceptedInvalidSuggestion = (() => {
    try {
      negativeLabNeutralPatchSuggestionSchema.parse(invalidSuggestion);
      return true;
    } catch {
      return false;
    }
  })();

  if (acceptedInvalidSuggestion) {
    throw new Error('Negative Lab neutral patch RGB suggestion schema accepted an invalid payload.');
  }
}

const modalSource = readFileSync('src/components/modals/negative-lab/NegativeConversionModal.tsx', 'utf8');
const visualSource = readFileSync('src/validation/visual/main.tsx', 'utf8');
const rustSource = readFileSync('src-tauri/src/negative_conversion.rs', 'utf8');

for (const marker of [
  'SuggestNegativeLabNeutralPatchRgbBalance',
  'negative-lab-suggest-neutral-patch-rgb',
  'negative-lab-neutral-patch-rgb-suggestion',
  'negative-lab-neutral-patch-application-risk',
  'negative-lab-neutral-patch-correction-magnitude',
  'negative-lab-neutral-patch-apply-warning',
  'negative-lab-apply-neutral-patch-rgb',
  'negativeLabNeutralPatchSuggestionSchema',
  'setFrameRgbBalanceOffsetByFrameId(nextOffsetsByFrameId)',
  'buildParamsWithFrameOverrides(',
]) {
  if (!modalSource.includes(marker) && !visualSource.includes(marker)) {
    throw new Error(`Negative Lab neutral patch RGB UI marker missing: ${marker}`);
  }
}

for (const marker of [
  'suggest_negative_lab_neutral_patch_rgb_balance',
  'build_negative_lab_neutral_patch_suggestion',
  'snap_negative_lab_rgb_offset',
  'negative_lab_neutrality_risk',
  'negative_lab_correction_risk',
  'apply_allowed',
  'offset_clamped',
]) {
  if (!rustSource.includes(marker)) {
    throw new Error(`Negative Lab neutral patch RGB runtime marker missing: ${marker}`);
  }
}

console.log('negative lab neutral patch rgb suggestion ok');

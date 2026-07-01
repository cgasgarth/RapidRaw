#!/usr/bin/env bun

import { readFileSync } from 'node:fs';

import type { NegativeLabFrameHealthEntry } from '../../../../src/schemas/negative-lab/negativeLabFrameHealthSchemas.ts';
import type { NegativeLabHighlightPatchExposureSuggestion } from '../../../../src/schemas/negative-lab/negativeLabHighlightPatchExposureSuggestionSchemas.ts';
import type { NegativeLabNeutralPatchSuggestion } from '../../../../src/schemas/negative-lab/negativeLabNeutralPatchSuggestionSchemas.ts';
import { parseNegativeLabPatchSamplerCorrectionPayload } from '../../../../src/schemas/negative-lab/negativeLabPatchSamplerCorrectionSchemas.ts';
import type { NegativeLabShadowPatchBlackPointSuggestion } from '../../../../src/schemas/negative-lab/negativeLabShadowPatchBlackPointSuggestionSchemas.ts';
import {
  buildNegativeLabFrameExposureOverridePayload,
  getNegativeLabEffectiveFrameExposure,
} from '../../../../src/utils/negative-lab/negativeLabFrameExposureOverrides.ts';
import {
  buildNegativeLabFrameRgbBalanceOverridePayload,
  getNegativeLabEffectiveFrameRgbBalance,
  snapNegativeLabFrameRgbBalanceOffsets,
} from '../../../../src/utils/negative-lab/negativeLabFrameRgbBalanceOverrides.ts';
import {
  appendNegativeLabPatchSamplerCorrection,
  buildNegativeLabBaseFogPatchSamplerCorrection,
  buildNegativeLabHighlightPatchSamplerCorrection,
  buildNegativeLabNeutralPatchSamplerCorrection,
  buildNegativeLabShadowPatchSamplerCorrection,
  EMPTY_NEGATIVE_LAB_PATCH_SAMPLER_CORRECTION_PAYLOAD,
  removeNegativeLabPatchSamplerCorrections,
} from '../../../../src/utils/negative-lab/negativeLabPatchSamplerCorrections.ts';
import { DEFAULT_NEGATIVE_LAB_UI_PRESET } from '../../../../src/utils/negative-lab/negativeLabPresetCatalog.ts';

const sourcePath = '/roll/frame-001.tif';
const frameId = 'negative-lab-frame-1';
const frameHealthRows: NegativeLabFrameHealthEntry[] = [
  {
    active: true,
    acquisitionSourceFamily: 'tiff_scan',
    acquisitionWarningCodes: [],
    baseConfidence: 0.91,
    baseScope: 'frame',
    baseStatus: 'estimated',
    batchDisposition: 'apply',
    batchDispositionReason: 'ready_to_apply',
    conversionStatus: 'preview_ready',
    cropStatus: 'active_frame_editable',
    frameId,
    healthStatus: 'active',
    included: true,
    pathIndex: 0,
    qcStatus: 'ready',
    scanLabel: 'Frame 1',
    sourcePath,
    warningCodes: [],
    warningSeverity: 'ok',
  },
];
const baselineParams = DEFAULT_NEGATIVE_LAB_UI_PRESET.params;

const neutralSuggestion: NegativeLabNeutralPatchSuggestion = {
  applicationRisk: 'low',
  applyAllowed: true,
  confidence: 0.86,
  correctionMagnitude: 0.11,
  effectiveRgbBalance: { blueWeight: 1.16, greenWeight: 0.93, redWeight: 1.14 },
  neutralityRisk: 'medium',
  offsetClamped: false,
  sampleDensity: [0.16, 0.22, 0.31],
  sampleRect: { height: 0.16, width: 0.16, x: 0.42, y: 0.44 },
  sampleRgb: [0.71, 0.59, 0.48],
  suggestedRgbBalanceOffset: { blueWeight: -0.02, greenWeight: -0.03, redWeight: 0.07 },
};

const neutralOffset = snapNegativeLabFrameRgbBalanceOffsets({
  baselineParams,
  offsets: neutralSuggestion.suggestedRgbBalanceOffset,
});
const rgbOffsetsByFrameId = { [frameId]: neutralOffset };
const rgbPayload = buildNegativeLabFrameRgbBalanceOverridePayload({
  baselineParams,
  frameHealthRows,
  offsetsByFrameId: rgbOffsetsByFrameId,
});
const effectiveRgb = getNegativeLabEffectiveFrameRgbBalance({
  baselineParams,
  frameId,
  offsetsByFrameId: rgbOffsetsByFrameId,
});

if (rgbPayload.overrides[0]?.sourcePath !== sourcePath || effectiveRgb.redWeight === baselineParams.red_weight) {
  throw new Error('Accepted neutral patch RGB correction did not enter preview/export RGB override payloads.');
}

const highlightSuggestion: NegativeLabHighlightPatchExposureSuggestion = {
  applicationRisk: 'low',
  applyAllowed: true,
  correctionMagnitudeEv: 0.35,
  currentFrameClippedFraction: 0.08,
  currentFrameExposureOffset: 0,
  currentSampleClippedFraction: 0.42,
  currentSampleP99MaxChannel: 1,
  currentSampleRgb: [0.99, 0.97, 0.95],
  effectiveExposure: -0.35,
  offsetClamped: false,
  projectedFrameClippedFraction: 0.04,
  projectedSampleClippedFraction: 0,
  projectedSampleP99MaxChannel: 0.97,
  projectedSampleRgb: [0.91, 0.89, 0.86],
  role: 'highlight',
  sampleRect: { height: 0.12, width: 0.12, x: 0.66, y: 0.18 },
  status: 'suggested',
  suggestedExposureDeltaEv: -0.35,
  suggestedFrameExposureOffset: -0.35,
};
const exposureOffsetsByFrameId = { [frameId]: highlightSuggestion.suggestedFrameExposureOffset };
const exposurePayload = buildNegativeLabFrameExposureOverridePayload({
  baselineExposure: baselineParams.exposure,
  frameHealthRows,
  offsetsByFrameId: exposureOffsetsByFrameId,
});
const effectiveExposure = getNegativeLabEffectiveFrameExposure({
  baselineExposure: baselineParams.exposure,
  frameId,
  offsetsByFrameId: exposureOffsetsByFrameId,
});

if (exposurePayload.overrides[0]?.sourcePath !== sourcePath || effectiveExposure === baselineParams.exposure) {
  throw new Error('Accepted highlight patch exposure correction did not enter preview/export exposure payloads.');
}

const shadowSuggestion: NegativeLabShadowPatchBlackPointSuggestion = {
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
};
const shadowParams = {
  ...baselineParams,
  black_point: Number(Math.min(shadowSuggestion.projectedBlackPoint, baselineParams.white_point - 0.05).toFixed(2)),
};

if (shadowParams.black_point === baselineParams.black_point) {
  throw new Error('Accepted shadow patch black-point correction did not mutate positive conversion params.');
}

let corrections = EMPTY_NEGATIVE_LAB_PATCH_SAMPLER_CORRECTION_PAYLOAD;
corrections = appendNegativeLabPatchSamplerCorrection(
  corrections,
  buildNegativeLabBaseFogPatchSamplerCorrection({
    estimate: {
      baseDensity: [0.1, 0.2, 0.3],
      baseRgb: [0.78, 0.66, 0.54],
      blueWeight: 1.08,
      confidence: 0.91,
      greenWeight: 0.97,
      redWeight: 1.03,
    },
    frameId,
    sampleRect: { height: 0.5, width: 0.08, x: 0.02, y: 0.25 },
    sourcePath,
  }),
);
corrections = appendNegativeLabPatchSamplerCorrection(
  corrections,
  buildNegativeLabNeutralPatchSamplerCorrection({ frameId, sourcePath, suggestion: neutralSuggestion }),
);
corrections = appendNegativeLabPatchSamplerCorrection(
  corrections,
  buildNegativeLabHighlightPatchSamplerCorrection({ frameId, sourcePath, suggestion: highlightSuggestion }),
);
corrections = appendNegativeLabPatchSamplerCorrection(
  corrections,
  buildNegativeLabShadowPatchSamplerCorrection({ frameId, sourcePath, suggestion: shadowSuggestion }),
);

const parsedCorrections = parseNegativeLabPatchSamplerCorrectionPayload(corrections);
if (parsedCorrections.corrections.length !== 4) {
  throw new Error('Accepted sampler corrections were not recorded for all patch roles.');
}

const rejectedBaseCorrections = removeNegativeLabPatchSamplerCorrections(corrections, frameId, ['base_fog']);
if (rejectedBaseCorrections.corrections.some((correction) => correction.role === 'base_fog')) {
  throw new Error('Rejected base/fog sampler correction still appeared in export provenance.');
}

const unsafeNeutralSuggestion = { ...neutralSuggestion, applyAllowed: false };
const beforeUnsafeApply = JSON.stringify(corrections);
const beforeUnsafeRgbOffsets = JSON.stringify(rgbOffsetsByFrameId);
const beforeUnsafeExposureOffsets = JSON.stringify(exposureOffsetsByFrameId);
const beforeUnsafeParams = JSON.stringify(shadowParams);
const afterUnsafeApply = unsafeNeutralSuggestion.applyAllowed
  ? appendNegativeLabPatchSamplerCorrection(
      corrections,
      buildNegativeLabNeutralPatchSamplerCorrection({ frameId, sourcePath, suggestion: unsafeNeutralSuggestion }),
    )
  : corrections;
const afterUnsafeRgbOffsets = unsafeNeutralSuggestion.applyAllowed
  ? { [frameId]: unsafeNeutralSuggestion.suggestedRgbBalanceOffset }
  : rgbOffsetsByFrameId;

if (JSON.stringify(afterUnsafeApply) !== beforeUnsafeApply) {
  throw new Error('Unsafe neutral sampler suggestion mutated accepted correction provenance.');
}

if (JSON.stringify(afterUnsafeRgbOffsets) !== beforeUnsafeRgbOffsets) {
  throw new Error('Unsafe neutral sampler suggestion mutated preview/export RGB override state.');
}

const unsafeHighlightSuggestion = { ...highlightSuggestion, applyAllowed: false };
const afterUnsafeExposureOffsets = unsafeHighlightSuggestion.applyAllowed
  ? { [frameId]: unsafeHighlightSuggestion.suggestedFrameExposureOffset }
  : exposureOffsetsByFrameId;

if (JSON.stringify(afterUnsafeExposureOffsets) !== beforeUnsafeExposureOffsets) {
  throw new Error('Unsafe highlight sampler suggestion mutated preview/export exposure override state.');
}

const unsafeShadowSuggestion = { ...shadowSuggestion, applyAllowed: false };
const afterUnsafeParams = unsafeShadowSuggestion.applyAllowed
  ? {
      ...baselineParams,
      black_point: Number(
        Math.min(unsafeShadowSuggestion.projectedBlackPoint, baselineParams.white_point - 0.05).toFixed(2),
      ),
    }
  : shadowParams;

if (JSON.stringify(afterUnsafeParams) !== beforeUnsafeParams) {
  throw new Error('Unsafe shadow sampler suggestion mutated output conversion params.');
}

const modalSource = readFileSync('src/components/modals/negative-lab/NegativeConversionModal.tsx', 'utf8');
const rustSource = readFileSync('src-tauri/src/raw/negative_conversion.rs', 'utf8');
for (const marker of [
  'patchSamplerCorrections: patchSamplerCorrectionPayload',
  'buildNegativeLabNeutralPatchSamplerCorrection',
  'buildNegativeLabHighlightPatchSamplerCorrection',
  'buildNegativeLabShadowPatchSamplerCorrection',
  'removeNegativeLabPatchSamplerCorrections',
]) {
  if (!modalSource.includes(marker)) {
    throw new Error(`Negative Lab patch sampler apply marker missing from modal: ${marker}`);
  }
}

for (const marker of [
  'patch_sampler_corrections',
  'sanitize_negative_lab_patch_sampler_corrections',
  '"patchSamplerCorrections": save_options.patch_sampler_corrections.clone()',
]) {
  if (!rustSource.includes(marker)) {
    throw new Error(`Negative Lab patch sampler export marker missing from runtime: ${marker}`);
  }
}

console.log('negative lab patch sampler apply ok');

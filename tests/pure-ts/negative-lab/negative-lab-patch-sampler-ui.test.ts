import { describe, expect, test } from 'bun:test';

import type { NegativeLabHighlightPatchExposureSuggestion } from '../../../src/schemas/negative-lab/negativeLabHighlightPatchExposureSuggestionSchemas.ts';
import type { NegativeLabNeutralPatchSuggestion } from '../../../src/schemas/negative-lab/negativeLabNeutralPatchSuggestionSchemas.ts';
import type { NegativeLabShadowPatchBlackPointSuggestion } from '../../../src/schemas/negative-lab/negativeLabShadowPatchBlackPointSuggestionSchemas.ts';
import { buildNegativeLabPickedPatchRect } from '../../../src/utils/negative-lab/negativeLabPatchPicker.ts';
import {
  appendNegativeLabPatchSamplerCorrection,
  buildNegativeLabHighlightPatchSamplerCorrection,
  buildNegativeLabNeutralPatchSamplerCorrection,
  buildNegativeLabShadowPatchSamplerCorrection,
  EMPTY_NEGATIVE_LAB_PATCH_SAMPLER_CORRECTION_PAYLOAD,
  removeNegativeLabPatchSamplerCorrections,
} from '../../../src/utils/negative-lab/negativeLabPatchSamplerCorrections.ts';
import {
  buildNegativeLabPatchProbeOverlayModels,
  formatNegativeLabSampleRectAttribute,
  getNegativeLabDensitometerLabelKeyForPatchRole,
  getNegativeLabPatchRoleForLabelKey,
  NEGATIVE_LAB_DENSITOMETER_PATCH_PRESETS,
  NEGATIVE_LAB_PATCH_ROLES,
} from '../../../src/utils/negative-lab/negativeLabPatchSamplerUi.ts';

const frameId = 'negative-lab-frame-1';
const sourcePath = '/synthetic/negative-lab/frame_001.tif';
const sampleRect = { height: 0.12, width: 0.18, x: 0.21, y: 0.34 };

const neutralSuggestion: NegativeLabNeutralPatchSuggestion = {
  applicationRisk: 'low',
  applyAllowed: true,
  confidence: 0.91,
  correctionMagnitude: 0.08,
  effectiveRgbBalance: { blueWeight: 1.08, greenWeight: 1, redWeight: 0.98 },
  neutralityRisk: 'low',
  offsetClamped: false,
  sampleDensity: [0.42, 0.41, 0.43],
  sampleRect,
  sampleRgb: [0.31, 0.32, 0.3],
  suggestedRgbBalanceOffset: { blueWeight: 0.03, greenWeight: 0, redWeight: 0.02 },
};

const highlightSuggestion: NegativeLabHighlightPatchExposureSuggestion = {
  applicationRisk: 'medium',
  applyAllowed: true,
  correctionMagnitudeEv: 0.35,
  currentFrameClippedFraction: 0.04,
  currentFrameExposureOffset: 0,
  currentSampleClippedFraction: 0.12,
  currentSampleP99MaxChannel: 0.99,
  currentSampleRgb: [0.96, 0.98, 0.99],
  effectiveExposure: 0,
  offsetClamped: false,
  projectedFrameClippedFraction: 0.01,
  projectedSampleClippedFraction: 0.02,
  projectedSampleP99MaxChannel: 0.92,
  projectedSampleRgb: [0.88, 0.9, 0.92],
  role: 'highlight',
  sampleRect,
  status: 'suggested',
  suggestedExposureDeltaEv: -0.35,
  suggestedFrameExposureOffset: -0.35,
};

const shadowSuggestion: NegativeLabShadowPatchBlackPointSuggestion = {
  applicationRisk: 'low',
  applyAllowed: true,
  correctionMagnitude: 0.04,
  currentBlackPoint: 0.02,
  currentSampleP01MinChannel: 0.1,
  currentSampleRgb: [0.08, 0.1, 0.12],
  endpointClamped: false,
  projectedBlackPoint: 0.06,
  projectedSampleP01MinChannel: 0.04,
  projectedSampleRgb: [0.03, 0.04, 0.05],
  role: 'shadow',
  sampleRect,
  status: 'suggested',
  suggestedBlackPointDelta: 0.04,
};

describe('Negative Lab patch sampler UI', () => {
  test('defines UI roles and preset patches for neutral, highlight, and shadow sampling', () => {
    expect(NEGATIVE_LAB_PATCH_ROLES).toEqual(['neutral', 'highlight', 'shadow']);
    expect(NEGATIVE_LAB_DENSITOMETER_PATCH_PRESETS.map((preset) => preset.labelKey)).toEqual([
      'modals.negativeConversion.sampleLeftEdge',
      'modals.negativeConversion.sampleCenterPatch',
      'modals.negativeConversion.sampleShadowPatch',
      'modals.negativeConversion.sampleHighlightPatch',
    ]);
    expect(NEGATIVE_LAB_DENSITOMETER_PATCH_PRESETS.map((preset) => preset.testId)).toEqual([
      'negative-lab-patch-probe-left-edge',
      'negative-lab-patch-probe-center-patch',
      'negative-lab-patch-probe-shadow-patch',
      'negative-lab-patch-probe-highlight-patch',
    ]);
  });

  test('routes preset and drawn patches to role-specific UI overlay models', () => {
    expect(getNegativeLabPatchRoleForLabelKey('modals.negativeConversion.sampleCenterPatch')).toBe('neutral');
    expect(getNegativeLabPatchRoleForLabelKey('modals.negativeConversion.sampleHighlightPatch')).toBe('highlight');
    expect(getNegativeLabPatchRoleForLabelKey('modals.negativeConversion.sampleShadowPatch')).toBe('shadow');
    expect(getNegativeLabDensitometerLabelKeyForPatchRole('neutral')).toBe(
      'modals.negativeConversion.sampleCenterPatch',
    );
    expect(getNegativeLabDensitometerLabelKeyForPatchRole('highlight')).toBe(
      'modals.negativeConversion.sampleHighlightPatch',
    );
    expect(getNegativeLabDensitometerLabelKeyForPatchRole('shadow')).toBe(
      'modals.negativeConversion.sampleShadowPatch',
    );

    expect(
      buildNegativeLabPatchProbeOverlayModels({
        highlight: { label: 'Highlight patch', rect: sampleRect },
        shadow: { label: 'Shadow patch', rect: { height: 0.08, width: 0.09, x: 0.01, y: 0.02 } },
      }),
    ).toEqual([
      {
        label: 'Highlight patch',
        role: 'highlight',
        sampleRectAttribute: formatNegativeLabSampleRectAttribute(sampleRect),
        testId: 'negative-lab-patch-probe-overlay-highlight',
      },
      {
        label: 'Shadow patch',
        role: 'shadow',
        sampleRectAttribute: '0.0100,0.0200,0.0900,0.0800',
        testId: 'negative-lab-patch-probe-overlay-shadow',
      },
    ]);
  });

  test('builds normalized rectangles for the preview drag workflow', () => {
    const rect = buildNegativeLabPickedPatchRect(
      { x: 160, y: 180 },
      { x: 360, y: 300 },
      { height: 400, left: 100, top: 100, width: 800 },
    );

    expect(rect).toEqual({
      height: 0.3,
      width: 0.25,
      x: 0.075,
      y: 0.2,
    });
  });

  test('keeps accepted sampler corrections role-scoped', () => {
    const corrections = [
      buildNegativeLabNeutralPatchSamplerCorrection({ frameId, sourcePath, suggestion: neutralSuggestion }),
      buildNegativeLabHighlightPatchSamplerCorrection({ frameId, sourcePath, suggestion: highlightSuggestion }),
      buildNegativeLabShadowPatchSamplerCorrection({ frameId, sourcePath, suggestion: shadowSuggestion }),
    ].reduce(appendNegativeLabPatchSamplerCorrection, EMPTY_NEGATIVE_LAB_PATCH_SAMPLER_CORRECTION_PAYLOAD);

    expect(corrections.corrections.map((correction) => correction.role)).toEqual([
      'neutral_rgb_balance',
      'highlight_exposure',
      'shadow_black_point',
    ]);
    expect(corrections.corrections.map((correction) => correction.sampleRect)).toEqual([
      sampleRect,
      sampleRect,
      sampleRect,
    ]);
  });

  test('removes role-scoped accepted corrections without touching unrelated roles', () => {
    const corrections = [
      buildNegativeLabNeutralPatchSamplerCorrection({ frameId, sourcePath, suggestion: neutralSuggestion }),
      buildNegativeLabHighlightPatchSamplerCorrection({ frameId, sourcePath, suggestion: highlightSuggestion }),
      buildNegativeLabShadowPatchSamplerCorrection({ frameId, sourcePath, suggestion: shadowSuggestion }),
    ].reduce(appendNegativeLabPatchSamplerCorrection, EMPTY_NEGATIVE_LAB_PATCH_SAMPLER_CORRECTION_PAYLOAD);

    expect(
      removeNegativeLabPatchSamplerCorrections(corrections, frameId, ['neutral_rgb_balance', 'shadow_black_point'])
        .corrections,
    ).toMatchObject([
      {
        frameId,
        role: 'highlight_exposure',
        sampleRect,
      },
    ]);
  });
});

import type { NegativeLabHighlightPatchExposureSuggestion } from '../../schemas/negative-lab/negativeLabHighlightPatchExposureSuggestionSchemas';
import type { NegativeLabNeutralPatchSuggestion } from '../../schemas/negative-lab/negativeLabNeutralPatchSuggestionSchemas';
import {
  NEGATIVE_LAB_PATCH_SAMPLER_CORRECTION_SCHEMA_VERSION,
  type NegativeLabPatchSamplerCorrection,
  type NegativeLabPatchSamplerCorrectionPayload,
  type NegativeLabPatchSamplerCorrectionRole,
  parseNegativeLabPatchSamplerCorrectionPayload,
} from '../../schemas/negative-lab/negativeLabPatchSamplerCorrectionSchemas';
import type {
  NegativeBaseFogEstimate,
  NegativeLabBaseFogSampleRect,
} from '../../schemas/negative-lab/negativeLabPresetCatalogSchemas';
import type { NegativeLabShadowPatchBlackPointSuggestion } from '../../schemas/negative-lab/negativeLabShadowPatchBlackPointSuggestionSchemas';
import { buildNegativeLabBaseSampleHash } from './negativeLabBaseSampleCommandBridge';

export type { NegativeLabPatchSamplerCorrectionPayload };

export const EMPTY_NEGATIVE_LAB_PATCH_SAMPLER_CORRECTION_PAYLOAD: NegativeLabPatchSamplerCorrectionPayload = {
  corrections: [],
  schemaVersion: NEGATIVE_LAB_PATCH_SAMPLER_CORRECTION_SCHEMA_VERSION,
};

const buildCorrectionId = (value: unknown): string =>
  `patch_sampler_${buildNegativeLabBaseSampleHash(JSON.stringify(value)).replace('fnv1a32:', '')}`;

const nowIso = (): string => new Date().toISOString();
const firstCorrection = (payload: NegativeLabPatchSamplerCorrectionPayload): NegativeLabPatchSamplerCorrection => {
  const correction = payload.corrections[0];
  if (correction === undefined) {
    throw new Error('Negative Lab patch sampler correction payload did not include a correction.');
  }
  return correction;
};

export const appendNegativeLabPatchSamplerCorrection = (
  payload: NegativeLabPatchSamplerCorrectionPayload,
  correction: NegativeLabPatchSamplerCorrection,
): NegativeLabPatchSamplerCorrectionPayload =>
  parseNegativeLabPatchSamplerCorrectionPayload({
    corrections: [
      ...payload.corrections.filter(
        (entry) => !(entry.frameId === correction.frameId && entry.role === correction.role),
      ),
      correction,
    ],
    schemaVersion: NEGATIVE_LAB_PATCH_SAMPLER_CORRECTION_SCHEMA_VERSION,
  });

export const removeNegativeLabPatchSamplerCorrections = (
  payload: NegativeLabPatchSamplerCorrectionPayload,
  frameId: string,
  roles: readonly NegativeLabPatchSamplerCorrectionRole[],
): NegativeLabPatchSamplerCorrectionPayload => {
  const roleSet = new Set(roles);
  return parseNegativeLabPatchSamplerCorrectionPayload({
    corrections: payload.corrections.filter((entry) => entry.frameId !== frameId || !roleSet.has(entry.role)),
    schemaVersion: NEGATIVE_LAB_PATCH_SAMPLER_CORRECTION_SCHEMA_VERSION,
  });
};

export const buildNegativeLabBaseFogPatchSamplerCorrection = ({
  estimate,
  frameId,
  sampleRect,
  sourcePath,
}: {
  estimate: NegativeBaseFogEstimate;
  frameId: string;
  sampleRect: NegativeLabBaseFogSampleRect | null;
  sourcePath: string;
}): NegativeLabPatchSamplerCorrection =>
  firstCorrection(
    parseNegativeLabPatchSamplerCorrectionPayload({
      corrections: [
        {
          accepted: true,
          appliedAt: nowIso(),
          correctionId: buildCorrectionId({ frameId, role: 'base_fog', sampleRect, sourcePath }),
          frameId,
          role: 'base_fog',
          sampleRect,
          sourceCommand: 'estimate_negative_base_fog',
          sourcePath,
          values: {
            baseDensity: estimate.baseDensity,
            baseFogStrength: 1,
            baseRgb: estimate.baseRgb,
            blueWeight: estimate.blueWeight,
            confidence: estimate.confidence,
            greenWeight: estimate.greenWeight,
            redWeight: estimate.redWeight,
          },
        },
      ],
      schemaVersion: NEGATIVE_LAB_PATCH_SAMPLER_CORRECTION_SCHEMA_VERSION,
    }),
  );

export const buildNegativeLabNeutralPatchSamplerCorrection = ({
  frameId,
  sourcePath,
  suggestion,
}: {
  frameId: string;
  sourcePath: string;
  suggestion: NegativeLabNeutralPatchSuggestion;
}): NegativeLabPatchSamplerCorrection =>
  firstCorrection(
    parseNegativeLabPatchSamplerCorrectionPayload({
      corrections: [
        {
          accepted: true,
          appliedAt: nowIso(),
          correctionId: buildCorrectionId({ frameId, role: 'neutral_rgb_balance', sourcePath, suggestion }),
          frameId,
          role: 'neutral_rgb_balance',
          sampleRect: suggestion.sampleRect,
          sourceCommand: 'suggest_negative_lab_neutral_patch_rgb_balance',
          sourcePath,
          values: {
            applicationRisk: suggestion.applicationRisk,
            confidence: suggestion.confidence,
            correctionMagnitude: suggestion.correctionMagnitude,
            effectiveRgbBalance: suggestion.effectiveRgbBalance,
            neutralityRisk: suggestion.neutralityRisk,
            suggestedRgbBalanceOffset: suggestion.suggestedRgbBalanceOffset,
          },
        },
      ],
      schemaVersion: NEGATIVE_LAB_PATCH_SAMPLER_CORRECTION_SCHEMA_VERSION,
    }),
  );

export const buildNegativeLabHighlightPatchSamplerCorrection = ({
  frameId,
  sourcePath,
  suggestion,
}: {
  frameId: string;
  sourcePath: string;
  suggestion: NegativeLabHighlightPatchExposureSuggestion;
}): NegativeLabPatchSamplerCorrection =>
  firstCorrection(
    parseNegativeLabPatchSamplerCorrectionPayload({
      corrections: [
        {
          accepted: true,
          appliedAt: nowIso(),
          correctionId: buildCorrectionId({ frameId, role: 'highlight_exposure', sourcePath, suggestion }),
          frameId,
          role: 'highlight_exposure',
          sampleRect: suggestion.sampleRect,
          sourceCommand: 'suggest_negative_lab_highlight_patch_exposure',
          sourcePath,
          values: {
            applicationRisk: suggestion.applicationRisk,
            effectiveExposure: suggestion.effectiveExposure,
            status: suggestion.status,
            suggestedExposureDeltaEv: suggestion.suggestedExposureDeltaEv,
            suggestedFrameExposureOffset: suggestion.suggestedFrameExposureOffset,
          },
        },
      ],
      schemaVersion: NEGATIVE_LAB_PATCH_SAMPLER_CORRECTION_SCHEMA_VERSION,
    }),
  );

export const buildNegativeLabShadowPatchSamplerCorrection = ({
  frameId,
  sourcePath,
  suggestion,
}: {
  frameId: string;
  sourcePath: string;
  suggestion: NegativeLabShadowPatchBlackPointSuggestion;
}): NegativeLabPatchSamplerCorrection =>
  firstCorrection(
    parseNegativeLabPatchSamplerCorrectionPayload({
      corrections: [
        {
          accepted: true,
          appliedAt: nowIso(),
          correctionId: buildCorrectionId({ frameId, role: 'shadow_black_point', sourcePath, suggestion }),
          frameId,
          role: 'shadow_black_point',
          sampleRect: suggestion.sampleRect,
          sourceCommand: 'suggest_negative_lab_shadow_patch_black_point',
          sourcePath,
          values: {
            applicationRisk: suggestion.applicationRisk,
            projectedBlackPoint: suggestion.projectedBlackPoint,
            status: suggestion.status,
            suggestedBlackPointDelta: suggestion.suggestedBlackPointDelta,
          },
        },
      ],
      schemaVersion: NEGATIVE_LAB_PATCH_SAMPLER_CORRECTION_SCHEMA_VERSION,
    }),
  );

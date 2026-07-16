import type { TFunction } from 'i18next';
import {
  type RawProcessingModeOverrideV1,
  type RawProcessingModeV1,
  rawProcessingModeOverrideV1Schema,
  rawProcessingModeV1Schema,
} from '../../packages/rawengine-schema/src/rawProcessingModeSchemas';

export const RAW_PROCESSING_MODES = rawProcessingModeV1Schema.options;

export type RawProcessingMode = RawProcessingModeV1;
export type RawProcessingModeOverride = RawProcessingModeOverrideV1;

export interface RawProcessingModeRecipe {
  applyPreprocessingToNonRaws: boolean;
  forceFastDemosaic: boolean;
  provenance: string;
  rawHighlightCompression: number;
  rawPreprocessingColorNr: number;
  rawPreprocessingSharpening: number;
  rawPreprocessingSharpeningDetail: number;
  rawPreprocessingSharpeningEdgeMasking: number;
  rawPreprocessingSharpeningRadius: number;
}

export const RAW_PROCESSING_MODE_RECIPES: Record<RawProcessingMode, RawProcessingModeRecipe> = {
  fast: {
    applyPreprocessingToNonRaws: false,
    forceFastDemosaic: true,
    provenance: 'speed_demosaic_no_capture_preprocessing_v1',
    rawHighlightCompression: 1.5,
    rawPreprocessingColorNr: 0,
    rawPreprocessingSharpening: 0,
    rawPreprocessingSharpeningDetail: 0,
    rawPreprocessingSharpeningEdgeMasking: 0,
    rawPreprocessingSharpeningRadius: 1,
  },
  balanced: {
    applyPreprocessingToNonRaws: false,
    forceFastDemosaic: false,
    provenance: 'default_quality_capture_preprocessing_v1',
    rawHighlightCompression: 2.5,
    rawPreprocessingColorNr: 0.5,
    rawPreprocessingSharpening: 0.35,
    rawPreprocessingSharpeningDetail: 0.45,
    rawPreprocessingSharpeningEdgeMasking: 0.3,
    rawPreprocessingSharpeningRadius: 2,
  },
  maximum: {
    applyPreprocessingToNonRaws: false,
    forceFastDemosaic: false,
    provenance: 'maximum_detail_capture_preprocessing_v1',
    rawHighlightCompression: 4,
    rawPreprocessingColorNr: 0.65,
    rawPreprocessingSharpening: 0.42,
    rawPreprocessingSharpeningDetail: 0.55,
    rawPreprocessingSharpeningEdgeMasking: 0.45,
    rawPreprocessingSharpeningRadius: 2.2,
  },
};

export const normalizeRawProcessingMode = (mode: string | null | undefined): RawProcessingMode =>
  rawProcessingModeV1Schema.safeParse(mode).data ?? 'balanced';

export const normalizeRawProcessingModeOverride = (mode: unknown): RawProcessingModeOverride =>
  rawProcessingModeOverrideV1Schema.safeParse(mode).data ?? null;

export const buildRawProcessingModePatch = (mode: RawProcessingMode): RawProcessingModeRecipe => ({
  ...RAW_PROCESSING_MODE_RECIPES[mode],
});

export const getRawProcessingModeDisplayCopy = (mode: RawProcessingMode, translate: TFunction): string => {
  return translate(`settings.processing.rawModes.${mode}.label`);
};

export const getRawProcessingModeProvenance = (mode: RawProcessingMode): string =>
  RAW_PROCESSING_MODE_RECIPES[mode].provenance;

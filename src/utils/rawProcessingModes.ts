export const RAW_PROCESSING_MODES = ['fast', 'balanced', 'maximum'] as const;

export type RawProcessingMode = (typeof RAW_PROCESSING_MODES)[number];
export type RawProcessingModeOverride = RawProcessingMode | null;

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
  RAW_PROCESSING_MODES.includes(mode as RawProcessingMode) ? (mode as RawProcessingMode) : 'balanced';

export const normalizeRawProcessingModeOverride = (mode: unknown): RawProcessingModeOverride =>
  typeof mode === 'string' && RAW_PROCESSING_MODES.includes(mode as RawProcessingMode)
    ? (mode as RawProcessingMode)
    : null;

export const buildRawProcessingModePatch = (mode: RawProcessingMode): RawProcessingModeRecipe => ({
  ...RAW_PROCESSING_MODE_RECIPES[mode],
});

import { captureSharpeningPresetSchema, type CaptureSharpeningPreset } from '../schemas/captureSharpeningSchemas';

export const CAPTURE_SHARPENING_PRESETS: Array<CaptureSharpeningPreset> = [
  {
    amount: 0.35,
    applyToNonRaw: false,
    colorNoiseReduction: 0.5,
    detail: 0.45,
    edgeMasking: 0.3,
    id: 'rawengine_capture_default',
    name: 'RAW Default Capture',
    radiusPx: 2,
    schemaVersion: 1,
    sourceClass: 'raw_low_iso',
    stage: 'post_demosaic_pre_global',
  },
  {
    amount: 0.28,
    applyToNonRaw: false,
    colorNoiseReduction: 0.75,
    detail: 0.3,
    edgeMasking: 0.55,
    id: 'rawengine_capture_high_iso',
    name: 'RAW High ISO Cautious',
    radiusPx: 2.5,
    schemaVersion: 1,
    sourceClass: 'raw_high_iso',
    stage: 'post_demosaic_pre_global',
  },
  {
    amount: 0.2,
    applyToNonRaw: true,
    colorNoiseReduction: 0.15,
    detail: 0.25,
    edgeMasking: 0.65,
    id: 'rawengine_capture_non_raw_opt_in',
    name: 'Non-RAW Opt-In Capture',
    radiusPx: 1,
    schemaVersion: 1,
    sourceClass: 'non_raw_opt_in',
    stage: 'post_demosaic_pre_global',
  },
].map((preset) => captureSharpeningPresetSchema.parse(preset));

export interface CaptureSharpeningProcessingPatch {
  applyPreprocessingToNonRaws: boolean;
  rawPreprocessingColorNr: number;
  rawPreprocessingSharpening: number;
  rawPreprocessingSharpeningDetail: number;
  rawPreprocessingSharpeningEdgeMasking: number;
  rawPreprocessingSharpeningRadius: number;
}

export const buildCaptureSharpeningProcessingPatch = (
  preset: CaptureSharpeningPreset,
): CaptureSharpeningProcessingPatch => ({
  applyPreprocessingToNonRaws: preset.applyToNonRaw,
  rawPreprocessingColorNr: preset.colorNoiseReduction,
  rawPreprocessingSharpening: preset.amount,
  rawPreprocessingSharpeningDetail: preset.detail,
  rawPreprocessingSharpeningEdgeMasking: preset.edgeMasking,
  rawPreprocessingSharpeningRadius: preset.radiusPx,
});

export const findMatchingCaptureSharpeningPreset = (
  settings: CaptureSharpeningProcessingPatch,
): CaptureSharpeningPreset | null =>
  CAPTURE_SHARPENING_PRESETS.find(
    (preset) =>
      preset.amount === settings.rawPreprocessingSharpening &&
      preset.colorNoiseReduction === settings.rawPreprocessingColorNr &&
      preset.detail === settings.rawPreprocessingSharpeningDetail &&
      preset.edgeMasking === settings.rawPreprocessingSharpeningEdgeMasking &&
      preset.radiusPx === settings.rawPreprocessingSharpeningRadius &&
      preset.applyToNonRaw === settings.applyPreprocessingToNonRaws,
  ) ?? null;

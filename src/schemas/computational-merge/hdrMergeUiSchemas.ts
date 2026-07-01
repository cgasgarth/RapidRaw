import { z } from 'zod';

export const hdrMergeAlignmentModeSchema = z.enum(['auto', 'translation', 'homography', 'optical_flow', 'none']);
export const hdrMergeBracketValidationSchema = z.enum(['required', 'warn', 'disabled']);
export const hdrMergeDeghostingSchema = z.enum(['off', 'low', 'medium', 'high']);
export const hdrMergeExposureWeightingModeSchema = z.enum(['balanced', 'protect_highlights', 'lift_shadows']);
export const hdrMergeStrategySchema = z.enum(['scene_linear_radiance', 'exposure_fusion_preview']);
export const hdrMergeQualityPreferenceSchema = z.enum(['preview', 'balanced', 'best']);
export const hdrToneMappingPresetSchema = z.enum([
  'custom',
  'natural',
  'highlight_detail',
  'interior_lift',
  'fast_preview',
]);

export const hdrMergeUiSettingsSchema = z
  .object({
    alignmentMode: hdrMergeAlignmentModeSchema,
    bracketValidation: hdrMergeBracketValidationSchema,
    deghostConfidenceMapVisible: z.boolean(),
    deghostRegionIntensityPercent: z.number().int().min(0).max(100),
    deghosting: hdrMergeDeghostingSchema,
    exposureWeightingMode: hdrMergeExposureWeightingModeSchema,
    maxPreviewDimensionPx: z.number().int().positive().max(8192),
    mergeStrategy: hdrMergeStrategySchema,
    qualityPreference: hdrMergeQualityPreferenceSchema,
    selectedSourceIndexes: z.array(z.number().int().nonnegative()).min(2),
    sourceMode: z.literal('exposure_bracket'),
    toneMapPreview: z.boolean(),
    toneMappingPreset: hdrToneMappingPresetSchema,
  })
  .strict();

export const hdrEditableSourceRefSchema = z
  .object({
    contentHash: z.string().min(1),
    contentState: z.string().min(1),
    displayName: z.string().min(1),
    graphRevision: z.string().min(1),
    sourceIndex: z.number().int().nonnegative(),
  })
  .strict();

const hdrParityHashSchema = z.string().regex(/^fnv1a32:[a-f0-9]{8}$/u);

export const hdrPreviewExportParitySummarySchema = z
  .object({
    comparedFields: z.array(
      z.enum([
        'deghosting',
        'displayPreviewColorState',
        'exportColorState',
        'mergeStrategy',
        'outputPath',
        'sourceRefs',
        'toneMapPreview',
      ]),
    ),
    exportReceiptHash: hdrParityHashSchema,
    meanAbsDelta: z.literal(0),
    parityProofHash: hdrParityHashSchema,
    previewStateHash: hdrParityHashSchema,
    status: z.literal('matched_editor_display_path'),
  })
  .strict();

export const hdrEditableHandoffSummarySchema = z
  .object({
    capabilityLevel: z.literal('runtime_apply_capable'),
    deghosting: hdrMergeDeghostingSchema,
    deghostReviewAccepted: z.boolean(),
    deghostReviewRequired: z.boolean(),
    displayPreviewColorState: z.literal('tone_mapped_srgb_preview'),
    editableDerivedAssetId: z.string().min(1),
    exportColorState: z.literal('saved_display_referred_srgb_output'),
    mergeStrategy: hdrMergeStrategySchema,
    outputColorSpace: z.literal('srgb_display_referred_v1'),
    outputEncoding: z.literal('display_referred_preview'),
    outputPath: z.string().min(1),
    previewExportParity: hdrPreviewExportParitySummarySchema,
    previewExportMeanAbsDelta: z.literal(0),
    previewExportParityStatus: z.literal('matched_editor_display_path'),
    previewToneMapped: z.boolean(),
    sceneMergeColorState: z.literal('legacy_display_referred_merge_after_linear_to_srgb'),
    sourceCount: z.number().int().nonnegative(),
    sourceRefs: z.array(hdrEditableSourceRefSchema),
    warningCodes: z.array(z.literal('tone_mapped_preview_only')),
    workingColorSpace: z.literal('srgb_display_referred_v1'),
  })
  .strict();

export type HdrMergeUiSettings = z.infer<typeof hdrMergeUiSettingsSchema>;
export type HdrMergeAlignmentMode = z.infer<typeof hdrMergeAlignmentModeSchema>;
export type HdrMergeBracketValidation = z.infer<typeof hdrMergeBracketValidationSchema>;
export type HdrMergeDeghosting = z.infer<typeof hdrMergeDeghostingSchema>;
export type HdrMergeExposureWeightingMode = z.infer<typeof hdrMergeExposureWeightingModeSchema>;
export type HdrMergeStrategy = z.infer<typeof hdrMergeStrategySchema>;
export type HdrMergeQualityPreference = z.infer<typeof hdrMergeQualityPreferenceSchema>;
export type HdrToneMappingPreset = z.infer<typeof hdrToneMappingPresetSchema>;
export type HdrEditableHandoffSummary = z.infer<typeof hdrEditableHandoffSummarySchema>;

type HdrToneMappingPresetPatch = Pick<
  HdrMergeUiSettings,
  | 'deghosting'
  | 'deghostConfidenceMapVisible'
  | 'deghostRegionIntensityPercent'
  | 'exposureWeightingMode'
  | 'maxPreviewDimensionPx'
  | 'mergeStrategy'
  | 'qualityPreference'
  | 'toneMapPreview'
  | 'toneMappingPreset'
>;

export const HDR_TONE_MAPPING_PRESETS: Array<{
  id: Exclude<HdrToneMappingPreset, 'custom'>;
  labelKey: string;
  patch: HdrToneMappingPresetPatch;
}> = [
  {
    id: 'natural',
    labelKey: 'modals.hdr.toneMappingPreset.natural',
    patch: {
      deghosting: 'medium',
      deghostConfidenceMapVisible: false,
      deghostRegionIntensityPercent: 65,
      exposureWeightingMode: 'balanced',
      maxPreviewDimensionPx: 2400,
      mergeStrategy: 'scene_linear_radiance',
      qualityPreference: 'balanced',
      toneMapPreview: true,
      toneMappingPreset: 'natural',
    },
  },
  {
    id: 'highlight_detail',
    labelKey: 'modals.hdr.toneMappingPreset.highlightDetail',
    patch: {
      deghosting: 'high',
      deghostConfidenceMapVisible: false,
      deghostRegionIntensityPercent: 85,
      exposureWeightingMode: 'protect_highlights',
      maxPreviewDimensionPx: 4096,
      mergeStrategy: 'scene_linear_radiance',
      qualityPreference: 'best',
      toneMapPreview: true,
      toneMappingPreset: 'highlight_detail',
    },
  },
  {
    id: 'interior_lift',
    labelKey: 'modals.hdr.toneMappingPreset.interiorLift',
    patch: {
      deghosting: 'medium',
      deghostConfidenceMapVisible: false,
      deghostRegionIntensityPercent: 70,
      exposureWeightingMode: 'lift_shadows',
      maxPreviewDimensionPx: 4096,
      mergeStrategy: 'exposure_fusion_preview',
      qualityPreference: 'balanced',
      toneMapPreview: true,
      toneMappingPreset: 'interior_lift',
    },
  },
  {
    id: 'fast_preview',
    labelKey: 'modals.hdr.toneMappingPreset.fastPreview',
    patch: {
      deghosting: 'low',
      deghostConfidenceMapVisible: false,
      deghostRegionIntensityPercent: 45,
      exposureWeightingMode: 'balanced',
      maxPreviewDimensionPx: 2400,
      mergeStrategy: 'exposure_fusion_preview',
      qualityPreference: 'preview',
      toneMapPreview: true,
      toneMappingPreset: 'fast_preview',
    },
  },
];

export const DEFAULT_HDR_MERGE_UI_SETTINGS = hdrMergeUiSettingsSchema.parse({
  alignmentMode: 'auto',
  bracketValidation: 'required',
  deghostConfidenceMapVisible: false,
  deghostRegionIntensityPercent: 65,
  deghosting: 'medium',
  exposureWeightingMode: 'balanced',
  maxPreviewDimensionPx: 2400,
  mergeStrategy: 'scene_linear_radiance',
  qualityPreference: 'balanced',
  selectedSourceIndexes: [0, 1, 2],
  sourceMode: 'exposure_bracket',
  toneMapPreview: true,
  toneMappingPreset: 'natural',
});

export const normalizeHdrMergeUiSettings = (value: unknown): HdrMergeUiSettings => {
  const parsed = hdrMergeUiSettingsSchema.safeParse(value);
  return parsed.success ? parsed.data : DEFAULT_HDR_MERGE_UI_SETTINGS;
};

export const applyHdrToneMappingPreset = (
  settings: HdrMergeUiSettings,
  preset: Exclude<HdrToneMappingPreset, 'custom'>,
): HdrMergeUiSettings => {
  const selectedPreset = HDR_TONE_MAPPING_PRESETS.find((candidate) => candidate.id === preset);
  if (!selectedPreset) return settings;
  return hdrMergeUiSettingsSchema.parse({ ...settings, ...selectedPreset.patch });
};

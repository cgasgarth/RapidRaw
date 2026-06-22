import { z } from 'zod';

export const hdrMergeAlignmentModeSchema = z.enum(['auto', 'translation', 'homography', 'optical_flow', 'none']);
export const hdrMergeBracketValidationSchema = z.enum(['required', 'warn', 'disabled']);
export const hdrMergeDeghostingSchema = z.enum(['off', 'low', 'medium', 'high']);
export const hdrMergeStrategySchema = z.enum(['scene_linear_radiance', 'exposure_fusion_preview']);
export const hdrMergeQualityPreferenceSchema = z.enum(['preview', 'balanced', 'best']);

export const hdrMergeUiSettingsSchema = z
  .object({
    alignmentMode: hdrMergeAlignmentModeSchema,
    bracketValidation: hdrMergeBracketValidationSchema,
    deghosting: hdrMergeDeghostingSchema,
    maxPreviewDimensionPx: z.number().int().positive().max(8192),
    mergeStrategy: hdrMergeStrategySchema,
    qualityPreference: hdrMergeQualityPreferenceSchema,
    sourceMode: z.literal('exposure_bracket'),
    toneMapPreview: z.boolean(),
  })
  .strict();

export const hdrEditableSourceRefSchema = z
  .object({
    contentState: z.string().min(1),
    displayName: z.string().min(1),
    graphRevision: z.literal('hdr_legacy_runtime_v1'),
    sourceIndex: z.number().int().nonnegative(),
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
export type HdrMergeStrategy = z.infer<typeof hdrMergeStrategySchema>;
export type HdrMergeQualityPreference = z.infer<typeof hdrMergeQualityPreferenceSchema>;
export type HdrEditableHandoffSummary = z.infer<typeof hdrEditableHandoffSummarySchema>;

export const DEFAULT_HDR_MERGE_UI_SETTINGS = hdrMergeUiSettingsSchema.parse({
  alignmentMode: 'auto',
  bracketValidation: 'required',
  deghosting: 'medium',
  maxPreviewDimensionPx: 2400,
  mergeStrategy: 'scene_linear_radiance',
  qualityPreference: 'balanced',
  sourceMode: 'exposure_bracket',
  toneMapPreview: true,
});

export const normalizeHdrMergeUiSettings = (value: unknown): HdrMergeUiSettings => {
  const parsed = hdrMergeUiSettingsSchema.safeParse(value);
  return parsed.success ? parsed.data : DEFAULT_HDR_MERGE_UI_SETTINGS;
};

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

export type HdrMergeUiSettings = z.infer<typeof hdrMergeUiSettingsSchema>;
export type HdrMergeAlignmentMode = z.infer<typeof hdrMergeAlignmentModeSchema>;
export type HdrMergeBracketValidation = z.infer<typeof hdrMergeBracketValidationSchema>;
export type HdrMergeDeghosting = z.infer<typeof hdrMergeDeghostingSchema>;
export type HdrMergeStrategy = z.infer<typeof hdrMergeStrategySchema>;
export type HdrMergeQualityPreference = z.infer<typeof hdrMergeQualityPreferenceSchema>;

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

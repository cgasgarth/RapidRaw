import { z } from 'zod';

export const hdrAlignmentModeSchema = z.enum(['auto', 'translation', 'none']);
export const hdrDeghostingModeSchema = z.enum(['off', 'low', 'medium', 'high']);
export const hdrMergeStrategySchema = z.enum(['scene_linear_radiance', 'exposure_fusion_preview']);
export const hdrQualityPreferenceSchema = z.enum(['preview', 'balanced', 'best']);

export const hdrUiSettingsSchema = z
  .object({
    alignmentMode: hdrAlignmentModeSchema,
    deghostingMode: hdrDeghostingModeSchema,
    maxPreviewDimensionPx: z.number().int().positive().max(8192),
    mergeStrategy: hdrMergeStrategySchema,
    qualityPreference: hdrQualityPreferenceSchema,
    sourceMode: z.literal('exposure_bracket'),
  })
  .strict();

export type HdrUiSettings = z.infer<typeof hdrUiSettingsSchema>;
export type HdrAlignmentMode = z.infer<typeof hdrAlignmentModeSchema>;
export type HdrDeghostingMode = z.infer<typeof hdrDeghostingModeSchema>;
export type HdrMergeStrategy = z.infer<typeof hdrMergeStrategySchema>;
export type HdrQualityPreference = z.infer<typeof hdrQualityPreferenceSchema>;

export const DEFAULT_HDR_UI_SETTINGS = hdrUiSettingsSchema.parse({
  alignmentMode: 'auto',
  deghostingMode: 'medium',
  maxPreviewDimensionPx: 2400,
  mergeStrategy: 'scene_linear_radiance',
  qualityPreference: 'best',
  sourceMode: 'exposure_bracket',
});

export const normalizeHdrUiSettings = (value: unknown): HdrUiSettings => {
  const parsed = hdrUiSettingsSchema.safeParse(value);
  return parsed.success ? parsed.data : DEFAULT_HDR_UI_SETTINGS;
};

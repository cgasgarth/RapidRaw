import { z } from 'zod';

export const superResolutionAlignmentModeSchema = z.enum(['auto', 'translation', 'homography', 'optical_flow']);
export const superResolutionDetailPolicySchema = z.enum(['conservative', 'balanced', 'aggressive_preview_only']);
export const superResolutionModeSchema = z.enum(['conservative', 'standard', 'aggressive']);
export const superResolutionQualityPreferenceSchema = z.enum(['preview', 'balanced', 'best']);

export const superResolutionUiSettingsSchema = z
  .object({
    alignmentMode: superResolutionAlignmentModeSchema,
    detailPolicy: superResolutionDetailPolicySchema,
    maxPreviewDimensionPx: z.number().int().positive().max(8192),
    outputScale: z.number().min(1.1).max(4),
    qualityPreference: superResolutionQualityPreferenceSchema,
    sourceMode: z.literal('multi_image'),
  })
  .strict();

export type SuperResolutionUiSettings = z.infer<typeof superResolutionUiSettingsSchema>;
export type SuperResolutionAlignmentMode = z.infer<typeof superResolutionAlignmentModeSchema>;
export type SuperResolutionDetailPolicy = z.infer<typeof superResolutionDetailPolicySchema>;
export type SuperResolutionMode = z.infer<typeof superResolutionModeSchema>;
export type SuperResolutionQualityPreference = z.infer<typeof superResolutionQualityPreferenceSchema>;

export const DEFAULT_SUPER_RESOLUTION_UI_SETTINGS = superResolutionUiSettingsSchema.parse({
  alignmentMode: 'auto',
  detailPolicy: 'conservative',
  maxPreviewDimensionPx: 2400,
  outputScale: 2,
  qualityPreference: 'best',
  sourceMode: 'multi_image',
});

export const normalizeSuperResolutionUiSettings = (value: unknown): SuperResolutionUiSettings => {
  const parsed = superResolutionUiSettingsSchema.safeParse(value);
  return parsed.success ? parsed.data : DEFAULT_SUPER_RESOLUTION_UI_SETTINGS;
};

export const getSuperResolutionModeForDetailPolicy = (
  detailPolicy: SuperResolutionDetailPolicy,
): SuperResolutionMode => {
  if (detailPolicy === 'balanced') return 'standard';
  if (detailPolicy === 'aggressive_preview_only') return 'aggressive';
  return 'conservative';
};

export const getSuperResolutionDetailPolicyForMode = (mode: SuperResolutionMode): SuperResolutionDetailPolicy => {
  if (mode === 'standard') return 'balanced';
  if (mode === 'aggressive') return 'aggressive_preview_only';
  return 'conservative';
};

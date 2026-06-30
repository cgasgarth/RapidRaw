import { z } from 'zod';

export const focusStackAlignmentModeSchema = z.enum(['auto', 'translation', 'homography', 'none']);
export const focusStackBlendMethodSchema = z.enum(['laplacian_pyramid', 'weighted_sharpness', 'depth_map']);
export const focusStackQualityPreferenceSchema = z.enum(['preview', 'balanced', 'best']);
export const focusStackRetouchLayerPolicySchema = z.enum(['none', 'generate_retouch_layer']);
export const focusStackReviewOverlayModeSchema = z.enum([
  'sharpness_map',
  'source_contribution',
  'low_confidence',
  'halo_risk',
]);

export const focusStackUiSettingsSchema = z
  .object({
    alignmentMode: focusStackAlignmentModeSchema,
    blendMethod: focusStackBlendMethodSchema,
    haloSuppressionStrengthPercent: z.number().int().min(0).max(100),
    maxPreviewDimensionPx: z.number().int().positive().max(8192),
    qualityPreference: focusStackQualityPreferenceSchema,
    reviewOverlayMode: focusStackReviewOverlayModeSchema,
    reviewOverlayOpacityPercent: z.number().int().min(25).max(100),
    retouchLayerPolicy: focusStackRetouchLayerPolicySchema,
    sourceMode: z.literal('focus_bracket'),
  })
  .strict();

export type FocusStackUiSettings = z.infer<typeof focusStackUiSettingsSchema>;
export type FocusStackAlignmentMode = z.infer<typeof focusStackAlignmentModeSchema>;
export type FocusStackBlendMethod = z.infer<typeof focusStackBlendMethodSchema>;
export type FocusStackQualityPreference = z.infer<typeof focusStackQualityPreferenceSchema>;
export type FocusStackReviewOverlayMode = z.infer<typeof focusStackReviewOverlayModeSchema>;
export type FocusStackRetouchLayerPolicy = z.infer<typeof focusStackRetouchLayerPolicySchema>;

export const DEFAULT_FOCUS_STACK_UI_SETTINGS = focusStackUiSettingsSchema.parse({
  alignmentMode: 'auto',
  blendMethod: 'laplacian_pyramid',
  haloSuppressionStrengthPercent: 0,
  maxPreviewDimensionPx: 2400,
  qualityPreference: 'best',
  reviewOverlayMode: 'sharpness_map',
  reviewOverlayOpacityPercent: 70,
  retouchLayerPolicy: 'generate_retouch_layer',
  sourceMode: 'focus_bracket',
});

export const normalizeFocusStackUiSettings = (value: unknown): FocusStackUiSettings => {
  const parsed = focusStackUiSettingsSchema.safeParse(value);
  return parsed.success ? parsed.data : DEFAULT_FOCUS_STACK_UI_SETTINGS;
};

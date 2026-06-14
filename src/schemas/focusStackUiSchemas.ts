import { z } from 'zod';

export const focusStackAlignmentModeSchema = z.enum(['auto', 'translation', 'homography', 'optical_flow']);
export const focusStackBlendMethodSchema = z.enum(['depth_map', 'laplacian_pyramid', 'weighted_sharpness']);
export const focusStackQualityPreferenceSchema = z.enum(['preview', 'balanced', 'best']);
export const focusStackRetouchPolicySchema = z.enum(['none', 'generate_retouch_layer']);

export const focusStackUiSettingsSchema = z
  .object({
    alignmentMode: focusStackAlignmentModeSchema,
    blendMethod: focusStackBlendMethodSchema,
    maxPreviewDimensionPx: z.number().int().positive().max(8192),
    qualityPreference: focusStackQualityPreferenceSchema,
    retouchPolicy: focusStackRetouchPolicySchema,
    sourceMode: z.literal('multi_image'),
  })
  .strict();

export type FocusStackUiSettings = z.infer<typeof focusStackUiSettingsSchema>;
export type FocusStackAlignmentMode = z.infer<typeof focusStackAlignmentModeSchema>;
export type FocusStackBlendMethod = z.infer<typeof focusStackBlendMethodSchema>;
export type FocusStackQualityPreference = z.infer<typeof focusStackQualityPreferenceSchema>;
export type FocusStackRetouchPolicy = z.infer<typeof focusStackRetouchPolicySchema>;

export const DEFAULT_FOCUS_STACK_UI_SETTINGS = focusStackUiSettingsSchema.parse({
  alignmentMode: 'auto',
  blendMethod: 'laplacian_pyramid',
  maxPreviewDimensionPx: 2400,
  qualityPreference: 'best',
  retouchPolicy: 'generate_retouch_layer',
  sourceMode: 'multi_image',
});

export const normalizeFocusStackUiSettings = (value: unknown): FocusStackUiSettings => {
  const parsed = focusStackUiSettingsSchema.safeParse(value);
  return parsed.success ? parsed.data : DEFAULT_FOCUS_STACK_UI_SETTINGS;
};

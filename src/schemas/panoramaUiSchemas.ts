import { z } from 'zod';

export const panoramaUiProjectionSchema = z.enum(['rectilinear', 'cylindrical', 'spherical']);
export const panoramaUiBoundaryModeSchema = z.enum(['auto_crop', 'transparent', 'manual_crop']);
export const panoramaUiBlendModeSchema = z.enum(['feather', 'multi_band']);
export const panoramaUiExposureModeSchema = z.enum(['gain_compensation', 'none']);
export const panoramaUiQualityPreferenceSchema = z.enum(['preview', 'balanced', 'best']);

export const panoramaUiSettingsSchema = z
  .object({
    blendMode: panoramaUiBlendModeSchema,
    boundaryMode: panoramaUiBoundaryModeSchema,
    exposureMode: panoramaUiExposureModeSchema,
    maxPreviewDimensionPx: z.number().int().positive().max(8192),
    projection: panoramaUiProjectionSchema,
    qualityPreference: panoramaUiQualityPreferenceSchema,
    sourceMode: z.literal('overlap_sequence'),
  })
  .strict();

export type PanoramaUiSettings = z.infer<typeof panoramaUiSettingsSchema>;
export type PanoramaUiProjection = z.infer<typeof panoramaUiProjectionSchema>;
export type PanoramaUiBoundaryMode = z.infer<typeof panoramaUiBoundaryModeSchema>;
export type PanoramaUiBlendMode = z.infer<typeof panoramaUiBlendModeSchema>;
export type PanoramaUiExposureMode = z.infer<typeof panoramaUiExposureModeSchema>;
export type PanoramaUiQualityPreference = z.infer<typeof panoramaUiQualityPreferenceSchema>;

export const DEFAULT_PANORAMA_UI_SETTINGS = panoramaUiSettingsSchema.parse({
  blendMode: 'multi_band',
  boundaryMode: 'auto_crop',
  exposureMode: 'gain_compensation',
  maxPreviewDimensionPx: 4096,
  projection: 'rectilinear',
  qualityPreference: 'best',
  sourceMode: 'overlap_sequence',
});

export const normalizePanoramaUiSettings = (value: unknown): PanoramaUiSettings => {
  const parsed = panoramaUiSettingsSchema.safeParse(value);
  return parsed.success ? parsed.data : DEFAULT_PANORAMA_UI_SETTINGS;
};

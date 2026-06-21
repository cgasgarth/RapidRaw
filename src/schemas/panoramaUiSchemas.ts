import { z } from 'zod';

export const panoramaUiProjectionSchema = z.enum(['rectilinear', 'cylindrical', 'spherical']);
export const panoramaUiBoundaryModeSchema = z.enum(['auto_crop', 'transparent', 'manual_crop']);
export const panoramaUiBlendModeSchema = z.enum(['feather', 'multi_band']);
export const panoramaUiExposureModeSchema = z.enum(['gain_compensation', 'none']);
export const panoramaUiQualityPreferenceSchema = z.enum(['preview', 'balanced', 'best']);
export const panoramaRuntimePlanStatusSchema = z.enum(['accepted', 'warning', 'blocked_plan_only']);

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

const panoramaPlanDimensionsSchema = z
  .object({
    height: z.number().int().positive(),
    width: z.number().int().positive(),
  })
  .strict();

const panoramaPlanMemoryComponentsSchema = z
  .object({
    low_detail_mask_bytes: z.number().int().nonnegative(),
    output_canvas_bytes: z.number().int().nonnegative(),
    output_mask_bytes: z.number().int().nonnegative(),
    overhead_bytes: z.number().int().nonnegative(),
    preview_bytes: z.number().int().nonnegative(),
    seam_workspace_bytes: z.number().int().nonnegative(),
    source_decode_bytes: z.number().int().nonnegative(),
    total_estimated_peak_bytes: z.number().int().nonnegative(),
  })
  .strict();

export const panoramaRuntimePlanSchema = z
  .object({
    dry_run: z.literal(true),
    family: z.literal('panorama'),
    output_dimensions: panoramaPlanDimensionsSchema,
    preflight: z
      .object({
        blocked_reasons: z.array(z.string()),
        execution_mode: z.string(),
        memory_budget_bytes: z.number().int().positive(),
        memory_budget_ratio: z.number().nonnegative(),
        memory_components: panoramaPlanMemoryComponentsSchema,
        status: panoramaRuntimePlanStatusSchema,
        tile_count: z.number().int().positive(),
        warning_codes: z.array(z.string()),
      })
      .loose(),
    source_image_refs: z.array(z.object({ image_path: z.string(), source_index: z.number().int() }).loose()),
    warnings: z.array(z.string()),
  })
  .loose();

export type PanoramaRuntimePlan = z.infer<typeof panoramaRuntimePlanSchema>;

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

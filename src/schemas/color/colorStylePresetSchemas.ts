import { z } from 'zod';

const jsonValueSchema: z.ZodType<JsonValue> = z.lazy(() =>
  z.union([
    z.string(),
    z.number(),
    z.boolean(),
    z.null(),
    z.array(jsonValueSchema),
    z.record(z.string(), jsonValueSchema),
  ]),
);

export const colorStylePresetCategorySchema = z.enum([
  'black_and_white',
  'cinematic',
  'landscape',
  'portrait',
  'product',
  'utility',
  'wedding',
]);

export const colorStylePresetAdjustmentKeySchema = z.enum([
  'colorCalibration',
  'colorGrading',
  'curveMode',
  'curves',
  'cameraProfile',
  'hsl',
  'lutData',
  'lutIntensity',
  'lutName',
  'lutPath',
  'lutSize',
  'parametricCurve',
  'pointCurves',
  'saturation',
  'temperature',
  'tint',
  'toneCurve',
  'vibrance',
]);

export type JsonValue = string | number | boolean | null | Array<JsonValue> | { [key: string]: JsonValue };
export type ColorStylePresetCategory = z.infer<typeof colorStylePresetCategorySchema>;
export type ColorStylePresetAdjustmentKey = z.infer<typeof colorStylePresetAdjustmentKeySchema>;

const colorStylePresetAdjustmentKeys = new Set<string>(colorStylePresetAdjustmentKeySchema.options);

export const colorStylePresetAdjustmentPatchSchema = z
  .record(z.string(), jsonValueSchema)
  .superRefine((patch, context) => {
    const entries = Object.entries(patch);
    if (entries.length === 0) {
      context.addIssue({ code: 'custom', message: 'Color style presets require at least one adjustment.' });
    }

    for (const [key] of entries) {
      if (!colorStylePresetAdjustmentKeys.has(key)) {
        context.addIssue({
          code: 'custom',
          message: `Unsupported color style adjustment key: ${key}`,
          path: [key],
        });
      }
    }
  });

export const colorStylePresetSchema = z
  .object({
    adjustmentPatch: colorStylePresetAdjustmentPatchSchema,
    category: colorStylePresetCategorySchema,
    createdAt: z.iso.datetime(),
    description: z.string().trim().min(1),
    id: z.string().regex(/^color_style\.[a-z0-9._-]+\.v[0-9]+$/u),
    name: z.string().trim().min(1),
    previewTags: z.array(z.string().trim().min(1)).min(1),
    updatedAt: z.iso.datetime(),
    version: z.literal(1),
  })
  .strict()
  .superRefine((preset, context) => {
    if (Date.parse(preset.updatedAt) < Date.parse(preset.createdAt)) {
      context.addIssue({ code: 'custom', message: 'updatedAt must be at or after createdAt.', path: ['updatedAt'] });
    }

    const hasLutPayload = 'lutData' in preset.adjustmentPatch || 'lutPath' in preset.adjustmentPatch;
    if (hasLutPayload && !('lutIntensity' in preset.adjustmentPatch)) {
      context.addIssue({
        code: 'custom',
        message: 'LUT color style presets must include lutIntensity.',
        path: ['adjustmentPatch', 'lutIntensity'],
      });
    }
  });

export const colorStylePresetCatalogSchema = z
  .object({
    defaultPresetId: z.string().trim().min(1).nullable(),
    presets: z.array(colorStylePresetSchema).min(1),
    version: z.literal(1),
  })
  .strict()
  .superRefine((catalog, context) => {
    const ids = new Set<string>();
    for (const [index, preset] of catalog.presets.entries()) {
      if (ids.has(preset.id)) {
        context.addIssue({
          code: 'custom',
          message: `Duplicate color style preset id: ${preset.id}`,
          path: ['presets', index, 'id'],
        });
      }
      ids.add(preset.id);
    }

    if (catalog.defaultPresetId !== null && !ids.has(catalog.defaultPresetId)) {
      context.addIssue({
        code: 'custom',
        message: 'defaultPresetId must reference a preset.',
        path: ['defaultPresetId'],
      });
    }
  });

export type ColorStylePresetAdjustmentPatch = z.infer<typeof colorStylePresetAdjustmentPatchSchema>;
export type ColorStylePreset = z.infer<typeof colorStylePresetSchema>;
export type ColorStylePresetCatalog = z.infer<typeof colorStylePresetCatalogSchema>;

export const parseColorStylePresetCatalog = (value: unknown): ColorStylePresetCatalog =>
  colorStylePresetCatalogSchema.parse(value);

export const listColorStylePresetAdjustmentKeys = (preset: ColorStylePreset): Array<ColorStylePresetAdjustmentKey> =>
  Object.keys(preset.adjustmentPatch).map((key) => colorStylePresetAdjustmentKeySchema.parse(key));

export const applyColorStylePresetPatch = (
  baseAdjustments: Record<string, JsonValue>,
  preset: ColorStylePreset,
): Record<string, JsonValue> => ({
  ...baseAdjustments,
  ...preset.adjustmentPatch,
});

import { z } from 'zod';

export const negativeLabPresetIdSchema = z.string().regex(/^negative_lab\.generic\.(?:c41|bw)\.[a-z0-9_]+\.v[0-9]+$/u);

export const negativeLabBaseFogSampleRectSchema = z
  .object({
    height: z.number().min(0.02).max(1),
    width: z.number().min(0.02).max(1),
    x: z.number().min(0).max(0.98),
    y: z.number().min(0).max(0.98),
  })
  .strict()
  .refine((rect) => rect.x + rect.width <= 1.000001 && rect.y + rect.height <= 1.000001, {
    message: 'Negative Lab base/fog sample rect must stay within normalized image bounds.',
  });

export const negativeLabPresetParamsSchema = z
  .object({
    blue_weight: z.number().min(0.5).max(2),
    base_fog_strength: z.number().min(0).max(1.25).default(1),
    base_fog_sample: negativeLabBaseFogSampleRectSchema.nullable().default(null),
    contrast: z.number().min(0.5).max(2.5),
    exposure: z.number().min(-2).max(2),
    green_weight: z.number().min(0.5).max(2),
    red_weight: z.number().min(0.5).max(2),
  })
  .strict();

export const negativeLabBuiltInUiPresetSchema = z
  .object({
    displayName: z.string().trim().min(1).max(80),
    intent: z.string().trim().min(1).max(160),
    params: negativeLabPresetParamsSchema,
    presetId: negativeLabPresetIdSchema,
    processHint: z.string().trim().min(1).max(80),
  })
  .strict();

export const negativeLabBuiltInUiPresetCatalogSchema = z
  .object({
    defaultPresetId: negativeLabPresetIdSchema,
    presets: z.array(negativeLabBuiltInUiPresetSchema).min(1),
    version: z.literal(1),
  })
  .strict()
  .superRefine((catalog, context) => {
    const presetIds = new Set<string>();
    const displayNames = new Set<string>();

    for (const [index, preset] of catalog.presets.entries()) {
      if (presetIds.has(preset.presetId)) {
        context.addIssue({ code: 'custom', message: 'Duplicate Negative Lab preset id.', path: ['presets', index] });
      }
      presetIds.add(preset.presetId);

      const displayName = preset.displayName.toLocaleLowerCase('en-US');
      if (displayNames.has(displayName)) {
        context.addIssue({
          code: 'custom',
          message: 'Duplicate Negative Lab preset display name.',
          path: ['presets', index],
        });
      }
      displayNames.add(displayName);

      const isBlackAndWhitePreset = preset.displayName.toLocaleLowerCase('en-US').includes('black and white');
      const hasBlackAndWhiteId = preset.presetId.includes('.bw.');
      if (isBlackAndWhitePreset !== hasBlackAndWhiteId) {
        context.addIssue({
          code: 'custom',
          message: 'Black-and-white preset names and ids must align.',
          path: ['presets', index],
        });
      }
    }

    if (!presetIds.has(catalog.defaultPresetId)) {
      context.addIssue({
        code: 'custom',
        message: 'Default Negative Lab preset must exist.',
        path: ['defaultPresetId'],
      });
    }
  });

export type NegativeLabBuiltInUiPreset = z.infer<typeof negativeLabBuiltInUiPresetSchema>;
export type NegativeLabBaseFogSampleRect = z.infer<typeof negativeLabBaseFogSampleRectSchema>;
export type NegativeLabPresetParams = z.infer<typeof negativeLabPresetParamsSchema>;
export type NegativeLabBuiltInUiPresetCatalog = z.infer<typeof negativeLabBuiltInUiPresetCatalogSchema>;

export const parseNegativeLabBuiltInUiPresetCatalog = (value: unknown): NegativeLabBuiltInUiPresetCatalog =>
  negativeLabBuiltInUiPresetCatalogSchema.parse(value);

export const negativeBaseFogEstimateSchema = z
  .object({
    blueWeight: z.number().min(0.5).max(2),
    confidence: z.number().min(0).max(1),
    greenWeight: z.number().min(0.5).max(2),
    redWeight: z.number().min(0.5).max(2),
  })
  .strict();

export const negativeConversionSavedPathsSchema = z.array(z.string().trim().min(1)).min(1);

export type NegativeBaseFogEstimate = z.infer<typeof negativeBaseFogEstimateSchema>;

export const parseNegativeBaseFogEstimate = (value: unknown): NegativeBaseFogEstimate =>
  negativeBaseFogEstimateSchema.parse(value);

export const parseNegativeConversionSavedPaths = (value: unknown): string[] =>
  negativeConversionSavedPathsSchema.parse(value);

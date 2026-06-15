import { z } from 'zod';

const colorWheelSchema = z
  .object({
    hue: z.number().min(0).lt(360),
    luminance: z.number().min(-100).max(100),
    saturation: z.number().min(0).max(100),
  })
  .strict();

export const colorGradingPresetSchema = z
  .object({
    balance: z.number().min(-100).max(100),
    blending: z.number().min(0).max(100),
    category: z.enum(['cinematic', 'portrait', 'landscape', 'neutral']),
    global: colorWheelSchema,
    highlights: colorWheelSchema,
    id: z.string().regex(/^color_grading\.[a-z0-9._-]+\.v[0-9]+$/u),
    midtones: colorWheelSchema,
    name: z.string().trim().min(1),
    shadows: colorWheelSchema,
    version: z.literal(1),
  })
  .strict();

export const colorGradingPresetCatalogSchema = z
  .object({
    presets: z.array(colorGradingPresetSchema).min(1),
    version: z.literal(1),
  })
  .strict()
  .superRefine((catalog, context) => {
    const ids = new Set<string>();
    for (const [index, preset] of catalog.presets.entries()) {
      if (ids.has(preset.id)) {
        context.addIssue({
          code: 'custom',
          message: `Duplicate color grading preset id: ${preset.id}`,
          path: ['presets', index, 'id'],
        });
      }
      ids.add(preset.id);
    }
  });

export type ColorGradingPreset = z.infer<typeof colorGradingPresetSchema>;
export type ColorGradingPresetCatalog = z.infer<typeof colorGradingPresetCatalogSchema>;

export const parseColorGradingPresetCatalog = (value: unknown): ColorGradingPresetCatalog =>
  colorGradingPresetCatalogSchema.parse(value);

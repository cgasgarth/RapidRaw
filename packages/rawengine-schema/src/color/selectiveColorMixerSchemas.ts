import { z } from 'zod';

const selectiveColorHslValueSchema = z
  .object({
    hue: z.number().finite().min(-100).max(100),
    luminance: z.number().finite().min(-100).max(100),
    saturation: z.number().finite().min(-100).max(100),
  })
  .strict();

const selectiveColorRangeControlSchema = z
  .object({
    centerHueDegrees: z.number().finite().min(0).lt(360),
    falloffSmoothness: z.number().finite().min(0.25).max(4),
    widthDegrees: z.number().finite().min(10).max(180),
  })
  .strict();

const fixedRangeMapSchema = <T extends z.ZodType>(valueSchema: T) =>
  z
    .object({
      aquas: valueSchema,
      blues: valueSchema,
      greens: valueSchema,
      magentas: valueSchema,
      oranges: valueSchema,
      purples: valueSchema,
      reds: valueSchema,
      yellows: valueSchema,
    })
    .strict();

const selectiveColorHslSchema = fixedRangeMapSchema(selectiveColorHslValueSchema);
const selectiveColorRangeControlsSchema = fixedRangeMapSchema(selectiveColorRangeControlSchema);

export const selectiveColorMixerSettingsSchema = z
  .object({
    hsl: selectiveColorHslSchema,
    selectiveColorRangeControls: selectiveColorRangeControlsSchema,
  })
  .strict();

export type SelectiveColorMixerSettings = z.infer<typeof selectiveColorMixerSettingsSchema>;

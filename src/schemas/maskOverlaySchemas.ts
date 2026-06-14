import { z } from 'zod';

export const maskOverlayModeSchema = z.enum([
  'hidden',
  'rubylith',
  'green',
  'blue',
  'white',
  'black',
  'grayscale',
  'inverse',
  'edges',
]);

export const maskOverlaySettingsSchema = z
  .object({
    edgeThreshold: z.number().min(0).max(1),
    mode: maskOverlayModeSchema,
    opacity: z.number().min(0).max(1),
  })
  .strict();

export type MaskOverlayMode = z.infer<typeof maskOverlayModeSchema>;
export type MaskOverlaySettings = z.infer<typeof maskOverlaySettingsSchema>;

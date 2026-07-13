import { z } from 'zod';

export const TONE_EQUALIZER_BAND_COUNT_V1 = 9;

export const toneEqualizerBandVectorV1Schema = z.tuple([
  z.number().finite().min(-4).max(4),
  z.number().finite().min(-4).max(4),
  z.number().finite().min(-4).max(4),
  z.number().finite().min(-4).max(4),
  z.number().finite().min(-4).max(4),
  z.number().finite().min(-4).max(4),
  z.number().finite().min(-4).max(4),
  z.number().finite().min(-4).max(4),
  z.number().finite().min(-4).max(4),
]);

export const toneEqualizerSettingsV1Schema = z
  .object({
    autoPlacement: z.boolean(),
    bandEv: toneEqualizerBandVectorV1Schema,
    detailPreservation: z.number().finite().min(0).max(1),
    edgeRefinement: z.number().finite().min(0).max(8),
    enabled: z.boolean(),
    maskExposureCompensation: z.number().finite().min(-4).max(4),
    pivotEv: z.number().finite().min(-8).max(8),
    previewMode: z.union([z.literal(0), z.literal(1), z.literal(2), z.literal(3), z.literal(4)]),
    rangeEv: z.number().finite().min(4).max(24),
    selectedBand: z
      .number()
      .int()
      .min(0)
      .max(TONE_EQUALIZER_BAND_COUNT_V1 - 1),
    smoothingRadius: z.number().finite().min(4).max(64),
  })
  .strict();

export type ToneEqualizerSettingsV1 = z.infer<typeof toneEqualizerSettingsV1Schema>;

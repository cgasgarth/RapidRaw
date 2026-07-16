import { z } from 'zod';

export const technicalWhiteBalanceV1Schema = z
  .object({
    contract: z.literal('rapidraw.white_balance.v1'),
    mode: z.enum(['as_shot', 'auto', 'kelvin_tint', 'chromaticity', 'preset']),
    kelvin: z.number().finite().min(1667).max(25000).describe('Correlated color temperature in kelvin.'),
    duv: z.number().finite().min(-0.05).max(0.05).describe('Signed 1960 UCS distance from the Planckian locus.'),
    x: z.number().finite().gt(0).lt(1).describe('CIE 1931 x chromaticity.'),
    y: z.number().finite().gt(0).lt(1).describe('CIE 1931 y chromaticity.'),
    adaptation: z.literal('cat16_v1'),
    source: z.enum(['as_shot', 'auto', 'picker', 'preset', 'user']),
    confidence: z.number().finite().min(0).max(1).nullable(),
    sampleCount: z.number().int().nonnegative().nullable(),
    inputSemantics: z.enum(['raw_scene_linear', 'rendered_scene_linear_approximation']),
    presetId: z.enum(['tungsten', 'daylight', 'flash', 'cloudy', 'shade']).nullable(),
    synchronization: z
      .object({
        mode: z.enum(['per_image', 'locked_reference']),
        referenceSourceIdentity: z.string().trim().min(1).nullable(),
      })
      .strict(),
  })
  .strict()
  .superRefine((settings, context) => {
    const sourceMatchesMode =
      (settings.mode === 'as_shot' && settings.source === 'as_shot') ||
      (settings.mode === 'auto' && settings.source === 'auto') ||
      (settings.mode === 'preset' && settings.source === 'preset') ||
      (settings.mode === 'chromaticity' && (settings.source === 'picker' || settings.source === 'user')) ||
      (settings.mode === 'kelvin_tint' && (settings.source === 'preset' || settings.source === 'user'));
    if (!sourceMatchesMode)
      context.addIssue({ code: 'custom', message: 'White balance mode and source are incompatible.' });
    if ((settings.mode === 'preset') !== (settings.presetId !== null)) {
      context.addIssue({ code: 'custom', message: 'Only preset mode requires a preset identity.', path: ['presetId'] });
    }
    const hasReference = settings.synchronization.referenceSourceIdentity !== null;
    if ((settings.synchronization.mode === 'locked_reference') !== hasReference) {
      context.addIssue({
        code: 'custom',
        message: 'Locked-reference synchronization requires exactly one reference identity.',
        path: ['synchronization'],
      });
    }
  })
  .refine(({ x, y }) => x + y < 1, { message: 'Chromaticity x+y must be below one.' });

export const whiteBalanceRuntimeReceiptV1Schema = z
  .object({
    contract: z.literal('rapidraw.white_balance.v1'),
    algorithm: z.enum([
      'as_shot_camera_neutral_v1',
      'auto_robust_neutral_v1',
      'neutral_patch_scene_linear_chromaticity_v1',
    ]),
    settings: technicalWhiteBalanceV1Schema,
    previewIdentity: z.string().trim().min(1),
    sourceFrameIdentity: z.string().trim().min(1),
    rejectedClippedSamples: z.number().int().nonnegative(),
    rejectedSaturatedSamples: z.number().int().nonnegative(),
    acceptedSamples: z.number().int().nonnegative(),
    confidence: z.number().min(0).max(1),
    limitationCodes: z.array(z.string().trim().min(1)),
  })
  .strict();

export type TechnicalWhiteBalanceV1 = z.infer<typeof technicalWhiteBalanceV1Schema>;
export type WhiteBalanceRuntimeReceiptV1 = z.infer<typeof whiteBalanceRuntimeReceiptV1Schema>;

import { z } from 'zod';

const percentAdjustmentSchema = z.number().min(0).max(100);
const normalizedScalarSchema = z.number().min(0).max(1);

export const noiseFixtureKindSchema = z.enum([
  'flat_shadow',
  'color_checker_shadow',
  'fine_texture_high_iso',
  'skin_high_iso',
  'edge_with_chroma_noise',
]);

export const noiseSeparationSettingsSchema = z
  .object({
    colorNoiseReduction: percentAdjustmentSchema,
    detailPreservation: normalizedScalarSchema,
    highIsoProtection: normalizedScalarSchema,
    lumaNoiseReduction: percentAdjustmentSchema,
  })
  .strict()
  .superRefine((settings, context) => {
    if (settings.lumaNoiseReduction > 70 && settings.detailPreservation < 0.35) {
      context.addIssue({
        code: 'custom',
        message: 'Strong luma noise reduction requires detailPreservation >= 0.35.',
        path: ['detailPreservation'],
      });
    }

    if (settings.colorNoiseReduction > 70 && settings.highIsoProtection < 0.35) {
      context.addIssue({
        code: 'custom',
        message: 'Strong color noise reduction requires highIsoProtection >= 0.35.',
        path: ['highIsoProtection'],
      });
    }
  });

export const noiseSeparationFixtureSchema = z
  .object({
    expectedLumaNoiseReduction: z.number().min(0).max(1),
    expectedMaxChromaBlurDeltaE: z.number().min(0).max(20),
    expectedMaxDetailLoss: z.number().min(0).max(1),
    expectedMaxHueShiftDeltaE: z.number().min(0).max(20),
    fixtureId: z.string().trim().min(1),
    iso: z.number().int().min(100).max(1_638_400),
    kind: noiseFixtureKindSchema,
    notes: z.string().trim().min(1),
    settings: noiseSeparationSettingsSchema,
  })
  .strict()
  .superRefine((fixture, context) => {
    if (fixture.iso >= 6400 && fixture.settings.highIsoProtection < 0.45) {
      context.addIssue({
        code: 'custom',
        message: 'High ISO fixtures require highIsoProtection >= 0.45.',
        path: ['settings', 'highIsoProtection'],
      });
    }

    if (fixture.kind.includes('texture') && fixture.expectedMaxDetailLoss > 0.25) {
      context.addIssue({
        code: 'custom',
        message: 'Texture fixtures must cap expectedMaxDetailLoss at 0.25.',
        path: ['expectedMaxDetailLoss'],
      });
    }

    if (fixture.kind.includes('chroma') && fixture.settings.colorNoiseReduction < fixture.settings.lumaNoiseReduction) {
      context.addIssue({
        code: 'custom',
        message: 'Chroma-noise fixtures must emphasize colorNoiseReduction over lumaNoiseReduction.',
        path: ['settings', 'colorNoiseReduction'],
      });
    }
  });

export const noiseSeparationFixtureListSchema = z.array(noiseSeparationFixtureSchema).min(1);

export type NoiseSeparationFixture = z.infer<typeof noiseSeparationFixtureSchema>;
export type NoiseSeparationSettings = z.infer<typeof noiseSeparationSettingsSchema>;

export const parseNoiseSeparationFixture = (value: unknown): NoiseSeparationFixture =>
  noiseSeparationFixtureSchema.parse(value);

export const parseNoiseSeparationFixtures = (value: unknown): NoiseSeparationFixture[] =>
  noiseSeparationFixtureListSchema.parse(value);

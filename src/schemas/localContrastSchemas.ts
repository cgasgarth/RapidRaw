import { z } from 'zod';

const percentAdjustmentSchema = z.number().min(-100).max(100);
const normalizedScalarSchema = z.number().min(0).max(1);

export const localContrastRiskSchema = z.enum(['low', 'medium', 'high']);
export const localContrastFixtureKindSchema = z.enum([
  'slanted_edge',
  'line_pair',
  'fine_texture',
  'high_iso_noise',
  'skin_detail',
  'flat_gradient',
]);

export const localContrastSettingsSchema = z
  .object({
    clarity: percentAdjustmentSchema,
    dehaze: percentAdjustmentSchema,
    edgeProtection: normalizedScalarSchema,
    haloBudgetPx: z.number().min(0).max(12),
    noiseProtection: normalizedScalarSchema,
    structure: percentAdjustmentSchema,
  })
  .strict()
  .superRefine((settings, context) => {
    const localContrastLoad =
      Math.abs(settings.clarity) + Math.abs(settings.structure) + Math.abs(settings.dehaze) * 0.5;

    if (localContrastLoad > 140 && settings.edgeProtection < 0.35) {
      context.addIssue({
        code: 'custom',
        message: 'Strong local contrast requires edgeProtection >= 0.35.',
        path: ['edgeProtection'],
      });
    }

    if (localContrastLoad > 120 && settings.haloBudgetPx > 4) {
      context.addIssue({
        code: 'custom',
        message: 'Strong local contrast must keep haloBudgetPx <= 4.',
        path: ['haloBudgetPx'],
      });
    }

    if (Math.abs(settings.dehaze) > 70 && settings.noiseProtection < 0.25) {
      context.addIssue({
        code: 'custom',
        message: 'High dehaze requires noiseProtection >= 0.25.',
        path: ['noiseProtection'],
      });
    }
  });

export const localContrastFixtureSchema = z
  .object({
    expectedRisk: localContrastRiskSchema,
    fixtureId: z.string().trim().min(1),
    kind: localContrastFixtureKindSchema,
    maxAllowedChromaShiftDeltaE: z.number().min(0).max(25),
    maxAllowedHaloPx: z.number().min(0).max(12),
    maxAllowedNoiseGain: z.number().min(0).max(4),
    minRequiredAcutanceGain: z.number().min(-1).max(4),
    notes: z.string().trim().min(1),
    settings: localContrastSettingsSchema,
  })
  .strict()
  .superRefine((fixture, context) => {
    if (fixture.kind === 'high_iso_noise' && fixture.settings.noiseProtection < 0.45) {
      context.addIssue({
        code: 'custom',
        message: 'High ISO fixtures require noiseProtection >= 0.45.',
        path: ['settings', 'noiseProtection'],
      });
    }

    if (fixture.kind === 'flat_gradient' && fixture.minRequiredAcutanceGain > 0.2) {
      context.addIssue({
        code: 'custom',
        message: 'Flat gradients should not require visible acutance gain.',
        path: ['minRequiredAcutanceGain'],
      });
    }

    if (fixture.expectedRisk === 'high' && fixture.maxAllowedHaloPx > 3) {
      context.addIssue({
        code: 'custom',
        message: 'High-risk fixtures must enforce maxAllowedHaloPx <= 3.',
        path: ['maxAllowedHaloPx'],
      });
    }
  });

export const localContrastFixtureListSchema = z.array(localContrastFixtureSchema).min(1);

export type LocalContrastFixture = z.infer<typeof localContrastFixtureSchema>;
export type LocalContrastSettings = z.infer<typeof localContrastSettingsSchema>;

export const parseLocalContrastFixture = (value: unknown): LocalContrastFixture =>
  localContrastFixtureSchema.parse(value);

export const parseLocalContrastFixtures = (value: unknown): LocalContrastFixture[] =>
  localContrastFixtureListSchema.parse(value);

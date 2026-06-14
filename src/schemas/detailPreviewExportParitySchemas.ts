import { z } from 'zod';

const normalizedSampleSchema = z.number().min(0).max(1);

const detailParitySettingsSchema = z
  .object({
    captureSharpeningAppliedBeforeParityStage: z.boolean(),
    detailAmount: z.number().min(-100).max(100),
    enabled: z.boolean(),
    outputSharpeningExcludedFromParityStage: z.boolean(),
    radiusPx: z.number().positive().max(64),
  })
  .strict()
  .superRefine((settings, context) => {
    if (!settings.enabled && settings.detailAmount !== 0) {
      context.addIssue({
        code: 'custom',
        message: 'Disabled detail parity settings must use amount 0.',
        path: ['detailAmount'],
      });
    }

    if (!settings.outputSharpeningExcludedFromParityStage) {
      context.addIssue({
        code: 'custom',
        message: 'Output sharpening must stay outside preview/export detail parity fixtures.',
        path: ['outputSharpeningExcludedFromParityStage'],
      });
    }
  });

export const detailPreviewExportParityFixtureSchema = z
  .object({
    expectedOutput: z.array(normalizedSampleSchema).min(3),
    fixtureId: z.string().regex(/^detail-parity\.[a-z0-9.-]+\.v[0-9]+$/u),
    inputSamples: z.array(normalizedSampleSchema).min(3),
    notes: z.string().trim().min(1),
    schemaVersion: z.literal(1),
    settings: detailParitySettingsSchema,
  })
  .strict()
  .superRefine((fixture, context) => {
    if (fixture.inputSamples.length !== fixture.expectedOutput.length) {
      context.addIssue({
        code: 'custom',
        message: 'Expected output must have the same sample count as input.',
        path: ['expectedOutput'],
      });
    }
  });

export const detailPreviewExportParityFixtureSetSchema = z.array(detailPreviewExportParityFixtureSchema).min(1);

export type DetailPreviewExportParityFixture = z.infer<typeof detailPreviewExportParityFixtureSchema>;

export function parseDetailPreviewExportParityFixtures(value: unknown): DetailPreviewExportParityFixture[] {
  return detailPreviewExportParityFixtureSetSchema.parse(value);
}

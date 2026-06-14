import { z } from 'zod';

const normalizedScalarSchema = z.number().min(0).max(1);

export const dustCandidateKindSchema = z.enum(['dust_spot', 'scratch', 'sensor_smear', 'false_positive_texture']);

export const dustOverlayCandidateSchema = z
  .object({
    confidence: normalizedScalarSchema,
    expectedFalsePositive: z.boolean(),
    id: z.string().trim().min(1),
    kind: dustCandidateKindSchema,
    radiusPx: z.number().positive().max(512),
    x: z.number().min(0),
    y: z.number().min(0),
  })
  .strict()
  .superRefine((candidate, context) => {
    if (candidate.expectedFalsePositive && candidate.confidence > 0.2) {
      context.addIssue({
        code: 'custom',
        message: 'Expected false positives must keep confidence <= 0.2.',
        path: ['confidence'],
      });
    }
  });

export const dustVisualizationFixtureSchema = z
  .object({
    candidates: z.array(dustOverlayCandidateSchema).min(1).max(256),
    expectedMaxFalsePositiveRate: normalizedScalarSchema,
    expectedMinRecall: normalizedScalarSchema,
    fixtureId: z.string().trim().min(1),
    height: z.number().int().positive().max(100_000),
    notes: z.string().trim().min(1),
    overlayMode: z.enum(['spots', 'scratches', 'all']),
    width: z.number().int().positive().max(100_000),
  })
  .strict()
  .superRefine((fixture, context) => {
    for (const [index, candidate] of fixture.candidates.entries()) {
      if (candidate.x > fixture.width || candidate.y > fixture.height) {
        context.addIssue({
          code: 'custom',
          message: 'Dust candidate coordinates must be inside fixture dimensions.',
          path: ['candidates', index],
        });
      }
    }

    if (fixture.expectedMinRecall < 0.7 && fixture.overlayMode !== 'spots') {
      context.addIssue({
        code: 'custom',
        message: 'Scratch/all overlays require expectedMinRecall >= 0.7.',
        path: ['expectedMinRecall'],
      });
    }
  });

export const dustVisualizationFixtureListSchema = z.array(dustVisualizationFixtureSchema).min(1);

export type DustVisualizationFixture = z.infer<typeof dustVisualizationFixtureSchema>;

export const parseDustVisualizationFixture = (value: unknown): DustVisualizationFixture =>
  dustVisualizationFixtureSchema.parse(value);

export const parseDustVisualizationFixtures = (value: unknown): DustVisualizationFixture[] =>
  dustVisualizationFixtureListSchema.parse(value);

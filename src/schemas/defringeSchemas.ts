import { z } from 'zod';

const normalizedScalarSchema = z.number().min(0).max(1);

export const defringeTargetSchema = z.enum(['purple', 'green']);
export const defringeFixtureKindSchema = z.enum([
  'backlit_branch',
  'specular_edge',
  'chrome_highlight',
  'text_edge',
  'false_positive_color_patch',
]);

export const defringeRangeSchema = z
  .object({
    hueCenterDeg: z.number().min(0).max(360),
    hueWidthDeg: z.number().min(5).max(120),
    minSaturation: normalizedScalarSchema,
    target: defringeTargetSchema,
  })
  .strict()
  .superRefine((range, context) => {
    const isPurpleHue = range.hueCenterDeg >= 250 && range.hueCenterDeg <= 330;
    const isGreenHue = range.hueCenterDeg >= 80 && range.hueCenterDeg <= 170;

    if (range.target === 'purple' && !isPurpleHue) {
      context.addIssue({
        code: 'custom',
        message: 'Purple defringe target requires hueCenterDeg between 250 and 330.',
        path: ['hueCenterDeg'],
      });
    }

    if (range.target === 'green' && !isGreenHue) {
      context.addIssue({
        code: 'custom',
        message: 'Green defringe target requires hueCenterDeg between 80 and 170.',
        path: ['hueCenterDeg'],
      });
    }
  });

export const defringeSettingsSchema = z
  .object({
    amount: normalizedScalarSchema,
    chromaProtection: normalizedScalarSchema,
    edgeThreshold: normalizedScalarSchema,
    ranges: z.array(defringeRangeSchema).min(1).max(4),
  })
  .strict()
  .superRefine((settings, context) => {
    if (settings.amount > 0.7 && settings.chromaProtection < 0.35) {
      context.addIssue({
        code: 'custom',
        message: 'Strong defringe requires chromaProtection >= 0.35.',
        path: ['chromaProtection'],
      });
    }

    if (settings.amount > 0.5 && settings.edgeThreshold < 0.2) {
      context.addIssue({
        code: 'custom',
        message: 'Strong defringe requires edgeThreshold >= 0.2.',
        path: ['edgeThreshold'],
      });
    }
  });

export const defringeFixtureSchema = z
  .object({
    expectedMaxProtectedColorDeltaE: z.number().min(0).max(20),
    expectedMinFringeReduction: normalizedScalarSchema,
    fixtureId: z.string().trim().min(1),
    kind: defringeFixtureKindSchema,
    notes: z.string().trim().min(1),
    settings: defringeSettingsSchema,
  })
  .strict()
  .superRefine((fixture, context) => {
    if (fixture.kind === 'false_positive_color_patch' && fixture.expectedMinFringeReduction > 0.05) {
      context.addIssue({
        code: 'custom',
        message: 'False-positive color patches must not require visible fringe reduction.',
        path: ['expectedMinFringeReduction'],
      });
    }

    if (fixture.kind !== 'false_positive_color_patch' && fixture.expectedMinFringeReduction < 0.25) {
      context.addIssue({
        code: 'custom',
        message: 'Real fringe fixtures require expectedMinFringeReduction >= 0.25.',
        path: ['expectedMinFringeReduction'],
      });
    }
  });

export const defringeFixtureListSchema = z.array(defringeFixtureSchema).min(1);

export type DefringeFixture = z.infer<typeof defringeFixtureSchema>;
export type DefringeSettings = z.infer<typeof defringeSettingsSchema>;

export const parseDefringeFixture = (value: unknown): DefringeFixture => defringeFixtureSchema.parse(value);

export const parseDefringeFixtures = (value: unknown): DefringeFixture[] => defringeFixtureListSchema.parse(value);

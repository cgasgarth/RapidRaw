import { z } from 'zod';

import { filmEmulationProfileRefV1Schema } from './filmEmulationSchemas.js';

const sha256Schema = z.string().regex(/^sha256:[a-f0-9]{64}$/u);
const rgbSchema = z.tuple([z.number().finite(), z.number().finite(), z.number().finite()]);
const cropSchema = z
  .tuple([
    z.number().finite().nonnegative(),
    z.number().finite().nonnegative(),
    z.number().finite().positive(),
    z.number().finite().positive(),
  ])
  .superRefine((crop, context) => {
    if (crop[0] + crop[2] > 1 || crop[1] + crop[3] > 1)
      context.addIssue({ code: 'custom', message: 'Proof crops must remain inside normalized bounds.' });
  });

export const filmValidationFixtureSourceV1Schema = z
  .object({
    logicalId: z.string().trim().min(1),
    pathOrPrivateRef: z.string().trim().min(1),
    sha256: sha256Schema,
    mediaType: z.string().trim().min(1),
    licenseSpdx: z.array(z.string().trim().min(1)).min(1),
    noticePaths: z.array(z.string().trim().min(1)).min(1),
    publicRepoAllowed: z.boolean(),
  })
  .strict();

export const filmValidationRegionV1Schema = z
  .object({
    id: z.string().trim().min(1),
    kind: z.enum(['neutral', 'ramp', 'edge', 'uniform', 'color_patch']),
    bounds: cropSchema,
    referenceRgb: rgbSchema.optional(),
  })
  .strict();

export const filmValidationThresholdsV1Schema = z
  .object({
    maxAbs: z.number().finite().nonnegative().max(0.1),
    rmse: z.number().finite().nonnegative().max(0.1),
    neutralAxisDrift: z.number().finite().nonnegative().max(0.1),
    identityDeltaE00: z.number().finite().nonnegative().max(1),
    monotonicTolerance: z.number().finite().nonnegative().max(0.01),
    grainRepeatTolerance: z.number().finite().nonnegative().max(0.1),
    opticalLeakage: z.number().finite().nonnegative().max(0.1),
  })
  .strict();

export const filmValidationFixtureV1Schema = z
  .object({
    contract: z.literal('rapidraw.film_validation_fixture.v1'),
    id: z.string().regex(/^film-validation\.[a-z0-9.-]+\.v\d+$/u),
    proofLevel: z.enum(['analytic_numeric', 'public_runtime_fixture', 'native_private_raw_reference']),
    source: filmValidationFixtureSourceV1Schema,
    input: z
      .object({
        domain: z.literal('acescg_linear_v1'),
        inputTransformId: z.string().trim().min(1),
        inputProfileId: z.string().trim().min(1).optional(),
        inputProfileSha256: sha256Schema.optional(),
        illuminant: z.string().trim().min(1).optional(),
        whiteBalance: rgbSchema.optional(),
        exposureOffsetEv: z.number().finite().optional(),
        orientation: z.number().int().min(0).max(359).optional(),
      })
      .strict(),
    regions: z.array(filmValidationRegionV1Schema).min(1),
    render: z
      .object({
        profileRefs: z.array(filmEmulationProfileRefV1Schema).min(1),
        viewTransforms: z.array(z.string().trim().min(1)).min(1),
        outputProfiles: z.array(z.string().trim().min(1)).min(1),
        bitDepths: z.array(z.union([z.literal(8), z.literal(16), z.literal(32)])).min(1),
        proofCrops: z.array(cropSchema).min(1),
      })
      .strict(),
    thresholds: filmValidationThresholdsV1Schema,
  })
  .strict()
  .superRefine((fixture, context) => {
    if ((fixture.input.inputProfileId === undefined) !== (fixture.input.inputProfileSha256 === undefined))
      context.addIssue({
        code: 'custom',
        message: 'Input profile ID and hash must be supplied together.',
        path: ['input'],
      });
    if (fixture.proofLevel !== 'native_private_raw_reference' && !fixture.source.publicRepoAllowed)
      context.addIssue({
        code: 'custom',
        message: 'Non-private proof levels must use a public/redistributable source.',
        path: ['source'],
      });
    if (fixture.proofLevel === 'native_private_raw_reference' && fixture.source.publicRepoAllowed)
      context.addIssue({ code: 'custom', message: 'Private RAW proof cannot be marked public.', path: ['source'] });
  });

export const filmAnalyticAssertionV1Schema = z.enum([
  'identity_disabled',
  'identity_mix_zero',
  'finite_full_mix',
  'neutral_full_mix',
]);

export const filmAnalyticVectorSetV1Schema = z
  .object({
    contract: z.literal('rapidraw.film_analytic_vectors.v1'),
    profileRef: filmEmulationProfileRefV1Schema,
    workingSpace: z.literal('acescg_linear_v1'),
    samples: z
      .array(
        z
          .object({
            id: z.string().regex(/^[a-z0-9][a-z0-9.-]*$/u),
            input: rgbSchema,
            assertions: z.array(filmAnalyticAssertionV1Schema).min(1),
          })
          .strict(),
      )
      .min(4),
    neutralRamp: z
      .object({
        id: z.string().regex(/^[a-z0-9][a-z0-9.-]*$/u),
        values: z.array(z.number().finite().nonnegative()).min(5),
      })
      .strict(),
  })
  .strict()
  .superRefine((vectors, context) => {
    const ids = [...vectors.samples.map(({ id }) => id), vectors.neutralRamp.id];
    if (new Set(ids).size !== ids.length)
      context.addIssue({ code: 'custom', message: 'Analytic vector IDs must be unique.', path: ['samples'] });
    if (vectors.neutralRamp.values.some((value, index, values) => index > 0 && value <= (values[index - 1] ?? value)))
      context.addIssue({
        code: 'custom',
        message: 'Neutral ramp values must increase.',
        path: ['neutralRamp', 'values'],
      });
    const assertions = new Set(vectors.samples.flatMap(({ assertions: sampleAssertions }) => sampleAssertions));
    for (const required of filmAnalyticAssertionV1Schema.options) {
      if (!assertions.has(required))
        context.addIssue({ code: 'custom', message: `Missing required analytic assertion: ${required}.` });
    }
  });

export const filmNativeAnalyticSampleReportV1Schema = z
  .object({
    id: z.string().trim().min(1),
    input: rgbSchema,
    disabledOutput: rgbSchema,
    mixZeroOutput: rgbSchema,
    fullMixOutput: rgbSchema,
  })
  .strict();

export const filmNativeAnalyticReportV1Schema = z
  .object({
    contract: z.literal('rapidraw.film_native_analytic_report.v1'),
    fixtureId: filmValidationFixtureV1Schema.shape.id,
    sourceSha256: sha256Schema,
    profileRef: filmEmulationProfileRefV1Schema,
    postFilmDomain: z.literal('acescg_linear_v1'),
    maxAbs: z.number().finite().nonnegative(),
    rmse: z.number().finite().nonnegative(),
    neutralAxisDrift: z.number().finite().nonnegative(),
    monotonicViolationCount: z.number().int().nonnegative(),
    negativeComponentCount: z.number().int().nonnegative(),
    highComponentCount: z.number().int().nonnegative(),
    deterministicHash: sha256Schema,
    samples: z.array(filmNativeAnalyticSampleReportV1Schema).min(1),
    passed: z.boolean(),
    failures: z.array(z.string().trim().min(1)),
  })
  .strict();

export const filmValidationReportV1Schema = z
  .object({
    contract: z.literal('rapidraw.film_validation_report.v1'),
    fixtureId: filmValidationFixtureV1Schema.shape.id,
    proofLevel: filmValidationFixtureV1Schema.shape.proofLevel,
    postFilmDomain: z.literal('acescg_linear_v1'),
    maxAbs: z.number().finite().nonnegative(),
    rmse: z.number().finite().nonnegative(),
    neutralAxisDrift: z.number().finite().nonnegative(),
    negativeComponentCount: z.number().int().nonnegative(),
    highComponentCount: z.number().int().nonnegative(),
    deterministicHash: sha256Schema,
    passed: z.boolean(),
    failures: z.array(z.string().trim().min(1)),
  })
  .strict();

export type FilmValidationFixtureV1 = z.infer<typeof filmValidationFixtureV1Schema>;
export type FilmValidationReportV1 = z.infer<typeof filmValidationReportV1Schema>;
export type FilmAnalyticVectorSetV1 = z.infer<typeof filmAnalyticVectorSetV1Schema>;
export type FilmNativeAnalyticReportV1 = z.infer<typeof filmNativeAnalyticReportV1Schema>;

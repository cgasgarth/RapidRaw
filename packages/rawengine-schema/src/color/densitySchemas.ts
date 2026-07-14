import { z } from 'zod';

export const densityTransformDescriptorV1Schema = z
  .object({
    contract: z.literal('rapidraw.density.v1'),
    interpretation: z.enum([
      'negative_transmittance',
      'positive_transmittance',
      'positive_reflectance',
      'engineered_pseudo_density',
    ]),
    polarity: z.enum(['negative', 'positive']),
    equation: z.literal('d_neg_log10_v1'),
    floor: z.number().finite().positive().lt(1),
    baseOrWhiteReference: z.tuple([
      z.number().finite().positive(),
      z.number().finite().positive(),
      z.number().finite().positive(),
    ]),
    flareOrBlackOffset: z.tuple([z.number().finite(), z.number().finite(), z.number().finite()]),
    channelOrder: z.literal('rgb'),
    numericPolicyVersion: z.string().min(1),
  })
  .strict()
  .superRefine((descriptor, context) => {
    if (descriptor.interpretation === 'negative_transmittance' && descriptor.polarity !== 'negative') {
      context.addIssue({
        code: 'custom',
        path: ['polarity'],
        message: 'Negative transmittance requires negative polarity.',
      });
    }
  });

export type DensityTransformDescriptorV1 = z.infer<typeof densityTransformDescriptorV1Schema>;

export const referenceNegativeDensityTransformV1: DensityTransformDescriptorV1 = {
  contract: 'rapidraw.density.v1',
  interpretation: 'negative_transmittance',
  polarity: 'negative',
  equation: 'd_neg_log10_v1',
  floor: 1e-6,
  baseOrWhiteReference: [1, 1, 1],
  flareOrBlackOffset: [0, 0, 0],
  channelOrder: 'rgb',
  numericPolicyVersion: 'density_floor_roundtrip_f64_v1',
};

densityTransformDescriptorV1Schema.parse(referenceNegativeDensityTransformV1);

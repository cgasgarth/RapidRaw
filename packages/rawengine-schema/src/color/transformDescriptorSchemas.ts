import { z } from 'zod';

export const colorTransformDescriptorV1Schema = z
  .object({
    contract: z.literal('rapidraw.color_transform.v1'),
    sourceDomain: z.string().min(1),
    destinationDomain: z.string().min(1),
    sourceEncoding: z.enum(['linear', 'log_density', 'display_encoded']),
    destinationEncoding: z.enum(['linear', 'log_density', 'display_encoded']),
    matrixDirection: z.enum(['source_to_destination', 'destination_to_source']).optional(),
    matrix3x3: z
      .tuple([
        z.tuple([z.number().finite(), z.number().finite(), z.number().finite()]),
        z.tuple([z.number().finite(), z.number().finite(), z.number().finite()]),
        z.tuple([z.number().finite(), z.number().finite(), z.number().finite()]),
      ])
      .optional(),
    sourceWhiteXy: z.tuple([z.number().finite().positive(), z.number().finite().positive()]).optional(),
    destinationWhiteXy: z.tuple([z.number().finite().positive(), z.number().finite().positive()]).optional(),
    chromaticAdaptation: z.enum(['none_same_white', 'bradford_v1', 'cat16_v1', 'already_adapted']),
    rangePolicy: z.enum(['preserve_extended_finite', 'physical_floor_only', 'target_gamut_stage']),
    channelOrder: z.literal('rgb'),
    numericPolicyVersion: z.string().min(1),
    contentSha256: z.string().regex(/^blake3:[0-9a-z-]+$/u),
  })
  .strict()
  .superRefine((descriptor, context) => {
    if (descriptor.matrix3x3 !== undefined && descriptor.matrixDirection === undefined) {
      context.addIssue({
        code: 'custom',
        path: ['matrixDirection'],
        message: 'Matrix direction is required when a matrix is present.',
      });
    }
    if (
      descriptor.chromaticAdaptation === 'none_same_white' &&
      descriptor.sourceWhiteXy &&
      descriptor.destinationWhiteXy &&
      String(descriptor.sourceWhiteXy) !== String(descriptor.destinationWhiteXy)
    ) {
      context.addIssue({
        code: 'custom',
        path: ['chromaticAdaptation'],
        message: 'Different whites require an explicit adaptation method.',
      });
    }
  });

export type ColorTransformDescriptorV1 = z.infer<typeof colorTransformDescriptorV1Schema>;

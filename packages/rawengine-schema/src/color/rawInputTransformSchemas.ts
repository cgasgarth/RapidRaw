import { z } from 'zod';

export const rawInputTransformReceiptV2Schema = z
  .object({
    asShotCameraWbGains: z.tuple([z.number().positive(), z.number().positive(), z.number().positive()]),
    cameraMakeModelId: z.string().trim().min(1),
    chromaticAdaptation: z.enum(['none_same_white', 'bradford_v1', 'already_adapted']),
    contract: z.literal('rapidraw.raw_input_transform.v2'),
    destinationDomain: z.literal('acescg_linear_v1'),
    destinationWhiteXy: z.tuple([z.literal(0.32168), z.literal(0.33767)]),
    greaterThanOneAp1ComponentCount: z.number().int().nonnegative(),
    invariantPolicyVersion: z.literal('camera_input_physical_invariants_v1'),
    limitationCodes: z.array(z.string().trim().min(1)),
    negativeAp1ComponentCount: z.number().int().nonnegative(),
    nonFiniteCount: z.literal(0),
    numericPolicyVersion: z.string().trim().min(1),
    outcome: z.literal('primary_calibrated_ap1'),
    outcomeReason: z.literal('validated_camera_profile'),
    profileSource: z.enum(['raw_metadata', 'project_profile']),
    resolverAlgorithmId: z.literal('dual_illuminant_mired_v1'),
    selectedCalibrationWhiteXy: z.tuple([z.number().positive(), z.number().positive()]),
    selectedMatrixDirection: z.literal('xyz_to_camera'),
    selectedMatrixSha256: z.string().regex(/^blake3:[0-9a-f]+$/u),
    sensorFloorCount: z.number().int().nonnegative(),
    sourceDomain: z.literal('linear_camera_rgb_v1'),
    transformContentSha256: z.string().regex(/^blake3:[0-9a-f]+$/u),
    workingPixelsBlake3: z.string().regex(/^blake3:[0-9a-f]+$/u),
    xyzToAp1MatrixVersion: z.string().trim().min(1),
  })
  .strict();

export type RawInputTransformReceiptV2 = z.infer<typeof rawInputTransformReceiptV2Schema>;

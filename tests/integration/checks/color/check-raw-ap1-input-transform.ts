import { rawInputTransformReceiptV2Schema } from '../../../../packages/rawengine-schema/src/color/rawInputTransformSchemas.ts';

const receipt = rawInputTransformReceiptV2Schema.parse({
  asShotCameraWbGains: [2, 1, 1.5],
  cameraMakeModelId: 'Fixture Camera',
  chromaticAdaptation: 'bradford_v1',
  contract: 'rapidraw.raw_input_transform.v2',
  destinationDomain: 'acescg_linear_v1',
  destinationWhiteXy: [0.32168, 0.33767],
  greaterThanOneAp1ComponentCount: 3,
  invariantPolicyVersion: 'camera_input_physical_invariants_v1',
  limitationCodes: [],
  negativeAp1ComponentCount: 2,
  nonFiniteCount: 0,
  numericPolicyVersion: 'camera_input_f64_inverse_cond_1e6_v2',
  outcome: 'primary_calibrated_ap1',
  outcomeReason: 'validated_camera_profile',
  profileSource: 'raw_metadata',
  resolverAlgorithmId: 'dual_illuminant_mired_v1',
  selectedCalibrationWhiteXy: [0.3127, 0.329],
  selectedMatrixDirection: 'xyz_to_camera',
  selectedMatrixSha256: `blake3:${'a'.repeat(64)}`,
  sensorFloorCount: 1,
  sourceDomain: 'linear_camera_rgb_v1',
  transformContentSha256: `blake3:${'b'.repeat(64)}`,
  workingPixelsBlake3: `blake3:${'c'.repeat(64)}`,
  xyzToAp1MatrixVersion: 'aces_ap1_xyz_d60_v1',
});

if (receipt.negativeAp1ComponentCount === 0 || receipt.greaterThanOneAp1ComponentCount === 0) {
  throw new Error('AP1 receipt must preserve and count finite extended-range components.');
}
for (const invalid of [
  { ...receipt, destinationDomain: 'srgb_linear_v1' },
  { ...receipt, selectedMatrixDirection: 'camera_to_xyz' },
  { ...receipt, nonFiniteCount: 1 },
]) {
  if (rawInputTransformReceiptV2Schema.safeParse(invalid).success) throw new Error('Invalid RAW input domain parsed.');
}
console.log('raw AP1 input-transform schema ok');

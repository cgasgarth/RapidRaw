import { describe, expect, test } from 'bun:test';

import { beginImageOpenResultSchema, rawDevelopmentReportSchema } from '../../../src/schemas/imageLoaderSchemas.ts';

const hash = `blake3:${'a'.repeat(64)}`;

const currentReport = {
  cameraProfile: {
    algorithmId: 'dual_illuminant_camera_neutral_mired_v2',
    candidateCount: 2,
    cctClamped: false,
    coolIlluminant: 'D65',
    coolWeight: 0.42,
    estimatedCctKelvin: 5100,
    fallbackReason: null,
    illuminantEstimateConfidence: 'high',
    illuminantEstimateMethod: 'white_balance_plan_v1',
    matrixHash: hash,
    profileIlluminantDuv: 0.012,
    profileIlluminantXy: [0.34567, 0.3585],
    status: 'interpolated',
    warmIlluminant: 'StandardLightA',
    whiteBalancePlanFingerprint: hash,
    warningCodes: [],
  },
  demosaicAlgorithmId: 'bayer_hq_v1',
  demosaicPath: 'bayer_hq',
  inputTransform: {
    asShotCameraWbGains: [2.1, 1, 1.4],
    cameraMakeModelId: 'Sony ILCE-7RM5',
    chromaticAdaptation: 'bradford_v1',
    contract: 'rapidraw.raw_input_transform.v2',
    destinationDomain: 'acescg_linear_v1',
    destinationWhiteXy: [0.32168, 0.33767],
    greaterThanOneAp1ComponentCount: 17,
    invariantPolicyVersion: 'camera_input_physical_invariants_v1',
    limitationCodes: [],
    negativeAp1ComponentCount: 3,
    nonFiniteCount: 0,
    numericPolicyVersion: 'camera_input_f64_inverse_cond_1e6_v2',
    outcome: 'primary_calibrated_ap1',
    outcomeReason: 'validated_camera_profile',
    profileSource: 'raw_metadata',
    resolverAlgorithmId: 'dual_illuminant_camera_neutral_mired_v2',
    selectedCalibrationWhiteXy: [0.34567, 0.3585],
    selectedMatrixDirection: 'xyz_to_camera',
    selectedMatrixSha256: hash,
    sensorFloorCount: 0,
    sourceDomain: 'linear_camera_rgb_v1',
    transformContentSha256: hash,
    workingPixelsBlake3: hash,
    xyzToAp1MatrixVersion: 'aces_ap1_xyz_d60_v1',
  },
  processingProfile: 'balanced',
  runtime: { cacheHit: false, decodeElapsedMs: 42, outputDimensions: [9504, 6336] },
  xtransHq: null,
} as const;

const legacyReport = {
  ...currentReport,
  cameraProfile: {
    ...currentReport.cameraProfile,
    algorithmId: 'dual_illuminant_mired_v1',
    illuminantEstimateMethod: 'wb_coeff_ratio',
    profileIlluminantDuv: undefined,
    profileIlluminantXy: undefined,
    whiteBalancePlanFingerprint: undefined,
  },
  inputTransform: {
    ...currentReport.inputTransform,
    resolverAlgorithmId: 'dual_illuminant_mired_v1',
  },
} as const;

describe('RAW development report compatibility boundary', () => {
  test('accepts the current native camera-profile and input-transform contract', () => {
    const parsed = rawDevelopmentReportSchema.parse(currentReport);
    expect(parsed.cameraProfile.illuminantEstimateMethod).toBe('white_balance_plan_v1');
    expect(parsed.inputTransform?.resolverAlgorithmId).toBe('dual_illuminant_camera_neutral_mired_v2');
    expect(parsed.cameraProfile.profileIlluminantXy).toEqual([0.34567, 0.3585]);
  });

  test('accepts the supported legacy report without changing its provenance', () => {
    const parsed = rawDevelopmentReportSchema.parse(legacyReport);
    expect(parsed.cameraProfile.illuminantEstimateMethod).toBe('wb_coeff_ratio');
    expect(parsed.inputTransform?.resolverAlgorithmId).toBe('dual_illuminant_mired_v1');
  });

  test('crosses the exact begin_image_open decoded IPC envelope', () => {
    const result = beginImageOpenResultSchema.parse({
      decodeReadyMillis: 51,
      decoded: {
        exif: null,
        height: 6336,
        is_raw: true,
        metadata: {},
        raw_development_report: currentReport,
        width: 9504,
      },
      imageId: 'alaska-current-raw',
      joinedPrefetch: false,
      metadataFingerprint: 'b'.repeat(64),
      metadataReadyMillis: 2,
      sessionId: { imageSession: 7, selectionGeneration: 7 },
    });
    expect(result.decoded.raw_development_report?.cameraProfile.algorithmId).toBe(
      'dual_illuminant_camera_neutral_mired_v2',
    );
  });

  test('quarantines unknown or malformed report revisions', () => {
    expect(() =>
      rawDevelopmentReportSchema.parse({
        ...currentReport,
        cameraProfile: { ...currentReport.cameraProfile, unversionedGuess: true },
      }),
    ).toThrow();
    expect(() =>
      rawDevelopmentReportSchema.parse({
        ...currentReport,
        cameraProfile: { ...currentReport.cameraProfile, illuminantEstimateMethod: 'guess_from_filename' },
      }),
    ).toThrow();
    expect(() =>
      rawDevelopmentReportSchema.parse({
        ...currentReport,
        inputTransform: { ...currentReport.inputTransform, resolverAlgorithmId: 'future_unreviewed_v3' },
      }),
    ).toThrow();
    expect(() =>
      rawDevelopmentReportSchema.parse({
        ...currentReport,
        inputTransform: { ...currentReport.inputTransform, resolverAlgorithmId: 'dual_illuminant_mired_v1' },
      }),
    ).toThrow();
    expect(() =>
      rawDevelopmentReportSchema.parse({
        ...currentReport,
        cameraProfile: { ...currentReport.cameraProfile, profileIlluminantXy: [0.8, 0.4] },
      }),
    ).toThrow();
  });
});

import { expect, test } from 'bun:test';

import { parseLoadImageResult } from '../../../src/schemas/imageLoaderSchemas';

const cameraProfile = {
  algorithmId: 'dual_illuminant_mired_v1',
  candidateCount: 1,
  illuminantEstimateConfidence: 'medium',
  illuminantEstimateMethod: 'camera_neutral_iterative',
  status: 'interpolated',
  warningCodes: [],
};

test('RAW graph stage samples cross the strict Tauri image-open boundary', () => {
  const parsed = parseLoadImageResult({
    height: 4_000,
    is_raw: true,
    raw_development_report: {
      cameraProfile,
      demosaicAlgorithmId: 'bayer_hq_v1',
      demosaicPath: 'bayer_hq',
      processingProfile: 'balanced',
      stageSamples: [
        {
          domain: 'sensor_mosaic_normalized_linear',
          elapsedMs: 12.5,
          nodeId: 'sensor_decode',
          samples: [[-0.01, 0.18, 1.25, 1]],
          version: 1,
        },
      ],
    },
    width: 6_000,
  });

  expect(parsed.raw_development_report?.stageSamples[0]).toEqual({
    domain: 'sensor_mosaic_normalized_linear',
    elapsedMs: 12.5,
    nodeId: 'sensor_decode',
    samples: [[-0.01, 0.18, 1.25, 1]],
    version: 1,
  });
});

test('RAW graph stage samples reject malformed numeric evidence', () => {
  expect(() =>
    parseLoadImageResult({
      height: 4_000,
      is_raw: true,
      raw_development_report: {
        cameraProfile,
        demosaicPath: 'bayer_hq',
        processingProfile: 'balanced',
        stageSamples: [
          {
            domain: 'sensor_mosaic_normalized_linear',
            elapsedMs: -1,
            nodeId: 'sensor_decode',
            samples: [[0, 0, 0, 1]],
            version: 1,
          },
        ],
      },
      width: 6_000,
    }),
  ).toThrow();
});

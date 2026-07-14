import { z } from 'zod';
import { filmMonochromeResponseV1Schema } from './filmMonochromeSchemas.js';

export const measuredMonochromeProfileV1Schema = z
  .object({
    id: z.literal('rapidraw.measured_monochrome_d65.v1'),
    version: z.literal('1'),
    claimClass: z.literal('measured_project_owned'),
    calibrationIlluminant: z.literal('D65_daylight_class'),
    limitationStatement: z.literal(
      'Project-owned D65 daylight-class RGB tristimulus fit; not universal spectral reconstruction or manufacturer stock emulation.',
    ),
    datasetId: z.string().min(1),
    datasetContentSha256: z.string().startsWith('sha256:'),
    trainSamples: z.number().int().positive(),
    holdoutSamples: z.number().int().positive(),
    holdoutLightnessRmse: z.number().finite().min(0).max(3),
    filterDensityRmse: z.number().finite().min(0).max(0.1),
    grainVarianceRelativeError: z.number().finite().min(0).max(0.1),
    response: filmMonochromeResponseV1Schema,
  })
  .strict()
  .superRefine((profile, context) => {
    if (
      profile.response.calibrationIlluminant !== profile.calibrationIlluminant ||
      profile.response.limitationStatement !== profile.limitationStatement
    )
      context.addIssue({
        code: 'custom',
        path: ['response'],
        message: 'Response provenance must match the profile claim.',
      });
  });

export type MeasuredMonochromeProfileV1 = z.infer<typeof measuredMonochromeProfileV1Schema>;

export const referenceMeasuredMonochromeProfileV1: MeasuredMonochromeProfileV1 = {
  id: 'rapidraw.measured_monochrome_d65.v1',
  version: '1',
  claimClass: 'measured_project_owned',
  calibrationIlluminant: 'D65_daylight_class',
  limitationStatement:
    'Project-owned D65 daylight-class RGB tristimulus fit; not universal spectral reconstruction or manufacturer stock emulation.',
  datasetId: 'rapidraw.project_owned.monochrome_d65_fixture_v1',
  datasetContentSha256: 'sha256:project-owned-monochrome-d65-fixture-v1',
  trainSamples: 96,
  holdoutSamples: 32,
  holdoutLightnessRmse: 2.1,
  filterDensityRmse: 0.06,
  grainVarianceRelativeError: 0.08,
  response: {
    model: 'rgb_tristimulus_monochrome_v1',
    sensitivityRgb: [0.66, 1, 0.42],
    calibrationIlluminant: 'D65_daylight_class',
    limitationStatement:
      'Project-owned D65 daylight-class RGB tristimulus fit; not universal spectral reconstruction or manufacturer stock emulation.',
    defaultFilter: { id: 'none', gainsRgb: [1, 1, 1], filterFactorStops: 0 },
    characteristicCurve: {
      model: 'monotone_pchip_v1',
      polarity: 'direct_positive',
      referenceGray: 0.18,
      domainEv: [-12, 8],
      exposureKnotsEv: [-12, -6, -2, 0, 2, 5, 8],
      responseKnots: [-10.8, -5.7, -1.8, 0, 1.75, 3.9, 5.6],
      endpointSlope: [0.84, 0.48],
    },
  },
};

measuredMonochromeProfileV1Schema.parse(referenceMeasuredMonochromeProfileV1);

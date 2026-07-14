import { strict as assert } from 'node:assert';

import {
  calibrationEvidenceRefV1Schema,
  colorTransformDescriptorV1Schema,
} from '../../../../packages/rawengine-schema/src/index.ts';

const descriptor = colorTransformDescriptorV1Schema.parse({
  contract: 'rapidraw.color_transform.v1',
  sourceDomain: 'negative_acquisition_rgb',
  destinationDomain: 'acescg_linear_v1',
  sourceEncoding: 'linear',
  destinationEncoding: 'linear',
  matrixDirection: 'source_to_destination',
  matrix3x3: [
    [1, 0, 0],
    [0, 1, 0],
    [0, 0, 1],
  ],
  chromaticAdaptation: 'none_same_white',
  rangePolicy: 'preserve_extended_finite',
  channelOrder: 'rgb',
  numericPolicyVersion: 'shared_color_f64_v1',
  contentSha256: 'blake3:descriptor-v1',
});
assert.equal(descriptor.matrixDirection, 'source_to_destination');
assert.throws(() => colorTransformDescriptorV1Schema.parse({ ...descriptor, matrixDirection: undefined }));

const evidence = calibrationEvidenceRefV1Schema.parse({
  evidenceId: 'rapidraw.project.fixture',
  evidenceVersion: '1',
  sourceKind: 'project_engineered',
  manifestPathOrUri: 'calibration/manifest.json',
  manifestSha256: 'sha256:fixture-manifest-v1',
  licenseSpdx: ['LicenseRef-RapidRaw-Project'],
  noticePaths: [],
  methodVersion: 'fixture_method_v1',
  limitations: ['Synthetic fixture; not a camera stock claim.'],
});
assert.equal(evidence.sourceKind, 'project_engineered');

console.log('shared color transform/provenance contract ok');

import { strict as assert } from 'node:assert';

import {
  measuredMonochromeProfileV1Schema,
  referenceMeasuredMonochromeProfileV1,
} from '../../../../packages/rawengine-schema/src/index.ts';

const profile = measuredMonochromeProfileV1Schema.parse(referenceMeasuredMonochromeProfileV1);
assert.equal(profile.id, 'rapidraw.measured_monochrome_d65.v1');
assert.equal(profile.claimClass, 'measured_project_owned');
assert.equal(profile.calibrationIlluminant, 'D65_daylight_class');
assert(profile.limitationStatement.includes('not universal spectral reconstruction'));
assert(profile.datasetContentSha256.startsWith('sha256:'));
assert(profile.trainSamples > 0);
assert(profile.holdoutSamples > 0);
assert(profile.holdoutLightnessRmse <= 3);
assert(profile.filterDensityRmse <= 0.1);
assert(profile.grainVarianceRelativeError <= 0.1);
assert.equal(profile.response.calibrationIlluminant, profile.calibrationIlluminant);

const invalidClaim = { ...profile, claimClass: 'universal_stock_emulation' };
assert.throws(() => measuredMonochromeProfileV1Schema.parse(invalidClaim));

console.log('measured monochrome profile contract ok');

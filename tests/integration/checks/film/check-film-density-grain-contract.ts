import { strict as assert } from 'node:assert';

import {
  filmDensityGrainV1Schema,
  referenceFilmDensityGrainV1,
} from '../../../../packages/rawengine-schema/src/index.ts';

const profile = filmDensityGrainV1Schema.parse(referenceFilmDensityGrainV1);
assert.equal(profile.model, 'layered_density_grain_v1');
assert.equal(profile.densityKnots.length, 6);
assert.equal(profile.sigmaByChannel[0]?.length, profile.densityKnots.length);
assert(profile.layers.some((layer) => layer.weight > 0));
assert.equal(profile.channelCorrelation[0]?.[0], 1);
assert.equal(profile.seedPolicy, 'source_profile_user_v1');

const invalidCurve = structuredClone(profile);
invalidCurve.densityKnots[2] = invalidCurve.densityKnots[1]!;
assert.throws(() => filmDensityGrainV1Schema.parse(invalidCurve));

const invalidCorrelation = structuredClone(profile);
invalidCorrelation.channelCorrelation[0]![1] = 1.5;
assert.throws(() => filmDensityGrainV1Schema.parse(invalidCorrelation));

const zeroLayers = structuredClone(profile);
zeroLayers.layers = zeroLayers.layers.map((layer) => ({ ...layer, weight: 0 }));
assert.throws(() => filmDensityGrainV1Schema.parse(zeroLayers));

console.log('film density grain contract ok');

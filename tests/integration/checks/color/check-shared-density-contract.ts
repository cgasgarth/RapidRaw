import { strict as assert } from 'node:assert';

import {
  densityTransformDescriptorV1Schema,
  referenceNegativeDensityTransformV1,
} from '../../../../packages/rawengine-schema/src/index.ts';

const density = densityTransformDescriptorV1Schema.parse(referenceNegativeDensityTransformV1);
assert.equal(density.equation, 'd_neg_log10_v1');
assert.equal(density.channelOrder, 'rgb');
assert.throws(() => densityTransformDescriptorV1Schema.parse({ ...density, polarity: 'positive' }));

console.log('shared density contract ok');

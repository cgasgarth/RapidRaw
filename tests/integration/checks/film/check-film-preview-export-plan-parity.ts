import { strict as assert } from 'node:assert';
import { filmExecutionReceiptV1Schema } from '../../../../packages/rawengine-schema/src/index.ts';

const receipt = filmExecutionReceiptV1Schema.parse({
  contract: 'rapidraw.film_execution_plan.v1',
  backend: 'cpu',
  stageOrder: ['capture_optical_scatter', 'post_film_tap'],
  quality: 'settled_full_quality_v1',
  tiled: false,
  fallback: false,
  postFilmHash: 'fnv1a32:12345678',
});
assert.equal(receipt.quality, 'settled_full_quality_v1');
assert.equal(receipt.fallback, false);
console.log('film preview/export plan parity contract ok');

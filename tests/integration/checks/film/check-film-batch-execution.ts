import { strict as assert } from 'node:assert';
import { filmExecutionReceiptV1Schema } from '../../../../packages/rawengine-schema/src/index.ts';

const receipts = ['source-a', 'source-b'].map((source) =>
  filmExecutionReceiptV1Schema.parse({
    contract: 'rapidraw.film_execution_plan.v1',
    backend: 'cpu',
    stageOrder: ['capture_optical_scatter', 'post_film_tap'],
    quality: 'settled_full_quality_v1',
    tiled: true,
    fallback: false,
    postFilmHash: `fnv1a32:${source}`,
  }),
);
assert.notEqual(receipts[0]!.postFilmHash, receipts[1]!.postFilmHash);
console.log('film batch execution contract ok');

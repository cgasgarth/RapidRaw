import { strict as assert } from 'node:assert';
import { filmExecutionStageOrderV1 } from '../../../../packages/rawengine-schema/src/index.ts';

assert(filmExecutionStageOrderV1.indexOf('density_grain') < filmExecutionStageOrderV1.indexOf('print_scan'));
assert(
  filmExecutionStageOrderV1.indexOf('capture_optical_scatter') <
    filmExecutionStageOrderV1.indexOf('characteristic_response'),
);
assert.equal(new Set(filmExecutionStageOrderV1).size, filmExecutionStageOrderV1.length);
console.log('film stage order ok');

import { strict as assert } from 'node:assert';

import {
  evaluateFilmCharacteristicCurveV1,
  filmCharacteristicCurveV1Schema,
  referenceFilmCharacteristicCurveV1,
} from '../../../../packages/rawengine-schema/src/index.ts';

const curve = filmCharacteristicCurveV1Schema.parse(referenceFilmCharacteristicCurveV1);
let previous = Number.NEGATIVE_INFINITY;
for (let index = 0; index < 4096; index += 1) {
  const exposure = -16 + (28 * index) / 4095;
  const value = evaluateFilmCharacteristicCurveV1(curve, exposure);
  assert(Number.isFinite(value), `curve output must be finite at ${exposure}`);
  assert(value >= previous, `curve must be monotone at ${exposure}`);
  previous = value;
}
assert(Math.abs(evaluateFilmCharacteristicCurveV1(curve, 0)) <= 1e-6, '18% gray anchor must be exact');

assert.throws(() =>
  filmCharacteristicCurveV1Schema.parse({
    ...curve,
    exposureKnotsEv: [-12, -6, -6, 0, 2, 5, 8],
  }),
);

console.log('film characteristic curve contract ok');

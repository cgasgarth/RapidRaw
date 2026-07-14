import { strict as assert } from 'node:assert';

import { filmPrintScanV1Schema, referenceFilmPrintScanV1 } from '../../../../packages/rawengine-schema/src/index.ts';

const profile = filmPrintScanV1Schema.parse(referenceFilmPrintScanV1);
assert.equal(profile.model, 'density_print_scan_v1');
for (const curve of profile.paper.responseKnots) {
  assert(curve.every(Number.isFinite));
  assert(curve.every((value, index) => index === 0 || value >= (curve[index - 1] ?? value)));
}
assert.deepEqual(profile.paper.dMin, [0.04, 0.04, 0.04]);
assert.equal(profile.scan.cat, 'none_already_adapted');

const invalid = structuredClone(profile);
const invalidRedCurve = invalid.paper.responseKnots[0] ?? [];
invalidRedCurve[2] = -0.5;
assert.throws(() => filmPrintScanV1Schema.parse(invalid));

const singular = structuredClone(profile);
singular.scan.matrixToXyz = [
  [1, 0, 0],
  [0, 0, 0],
  [0, 0, 1],
];
assert.throws(() => filmPrintScanV1Schema.parse(singular));

console.log('film print scan contract ok');

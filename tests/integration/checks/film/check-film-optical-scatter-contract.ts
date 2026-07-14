import { strict as assert } from 'node:assert';

import {
  filmOpticalScatterV1Schema,
  referenceFilmOpticalScatterV1,
} from '../../../../packages/rawengine-schema/src/index.ts';

const profile = filmOpticalScatterV1Schema.parse(referenceFilmOpticalScatterV1);
assert.equal(profile.model, 'multiscale_optical_scatter_v1');
assert.equal(profile.halation.radiiPxFullRes.length, profile.halation.weights.length);
assert(profile.halation.weights.some((weight) => weight > 0));
assert.equal(profile.bloom?.placement, 'capture_pre_response');

const invalidKernel = structuredClone(profile);
invalidKernel.halation.weights = [0, 0, 0];
assert.throws(() => filmOpticalScatterV1Schema.parse(invalidKernel));

const invalidStage = structuredClone(profile);
invalidStage.halation.sourceThresholdEv = [3, 1];
assert.throws(() => filmOpticalScatterV1Schema.parse(invalidStage));

const unsupportedPlacement = structuredClone(profile);
unsupportedPlacement.bloom!.placement = 'print_pre_paper';
assert.throws(() => filmOpticalScatterV1Schema.parse(unsupportedPlacement));

console.log('film optical scatter contract ok');

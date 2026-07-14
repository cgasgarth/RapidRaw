import { strict as assert } from 'node:assert';
import { compiledFilmProfileV1Schema } from '../../../../packages/rawengine-schema/src/index.ts';

const valid = {
  profileId: 'rapidraw.reference_film.v1',
  profileVersion: '1',
  manifestContentSha256: 'sha256:' + 'a'.repeat(64),
  decodedAssetSha256: {},
  modelAbiVersion: 'film_model_abi_v1',
  compilerVersion: 'film_profile_compiler_v1',
  numericPolicyVersion: 'film_numeric_policy_v1',
  workingSpace: 'acescg_linear_v1',
  compiledContentSha256: 'sha256:' + 'b'.repeat(64),
};
assert.equal(compiledFilmProfileV1Schema.parse(valid).workingSpace, 'acescg_linear_v1');
assert.throws(() => compiledFilmProfileV1Schema.parse({ ...valid, compiledContentSha256: 'bad' }));
console.log('film profile compiler contract ok');

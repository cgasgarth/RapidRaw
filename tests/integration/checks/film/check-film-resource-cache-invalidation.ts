import { strict as assert } from 'node:assert';
import { compiledFilmProfileKeyV1 } from '../../../../packages/rawengine-schema/src/index.ts';

const base = {
  manifestContentSha256: 'sha256:' + 'a'.repeat(64),
  decodedAssetSha256: { curve: 'sha256:' + 'b'.repeat(64) },
  modelAbiVersion: 'film_model_abi_v1',
  compilerVersion: 'film_profile_compiler_v1',
  numericPolicyVersion: 'film_numeric_policy_v1',
};
const key = compiledFilmProfileKeyV1(base);
assert.equal(key, compiledFilmProfileKeyV1(base));
assert.notEqual(key, compiledFilmProfileKeyV1({ ...base, manifestContentSha256: 'sha256:' + 'c'.repeat(64) }));
assert.notEqual(key, compiledFilmProfileKeyV1({ ...base, decodedAssetSha256: { curve: 'sha256:' + 'd'.repeat(64) } }));
assert.notEqual(key, compiledFilmProfileKeyV1({ ...base, numericPolicyVersion: 'film_numeric_policy_v2' }));
console.log('film resource cache invalidation ok');

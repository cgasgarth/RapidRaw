import { strict as assert } from 'node:assert';
import { compiledFilmProfileKeyV1, gpuFilmResourceKeyV1 } from '../../../../packages/rawengine-schema/src/index.ts';

const base = {
  manifestContentSha256: 'sha256:' + 'a'.repeat(64),
  decodedAssetSha256: { z: 'sha256:' + 'b'.repeat(64), a: 'sha256:' + 'c'.repeat(64) },
  modelAbiVersion: 'film_model_abi_v1',
  compilerVersion: 'film_profile_compiler_v1',
  numericPolicyVersion: 'film_numeric_policy_v1',
};
const reordered = { ...base, decodedAssetSha256: { a: base.decodedAssetSha256.a, z: base.decodedAssetSha256.z } };
assert.equal(compiledFilmProfileKeyV1(base), compiledFilmProfileKeyV1(reordered));
assert.notEqual(
  compiledFilmProfileKeyV1(base),
  compiledFilmProfileKeyV1({ ...base, compilerVersion: 'film_profile_compiler_v2' }),
);
assert.notEqual(
  gpuFilmResourceKeyV1(compiledFilmProfileKeyV1(base), 'adapter-a', 'shader-a', 'rgba16f', 'storage'),
  gpuFilmResourceKeyV1(compiledFilmProfileKeyV1(base), 'adapter-b', 'shader-a', 'rgba16f', 'storage'),
);
console.log('film resource cache keys ok');

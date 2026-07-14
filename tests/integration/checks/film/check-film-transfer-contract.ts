import { strict as assert } from 'node:assert';

import { filmEmulationTransferV1Schema } from '../../../../packages/rawengine-schema/src/index.ts';

const transfer = filmEmulationTransferV1Schema.parse({
  contract: 'rapidraw.film_transfer.v1',
  profileRef: { id: 'rapidraw.generic_mono.v1', version: '1', contentSha256: `sha256:${'a'.repeat(64)}` },
  enabled: true,
  mix: 0.65,
  stageOverrides: { referenceLuminanceShaperP: 1.1 },
  stackPlacement: { position: 'scene_creative_end' },
  seedTransferPolicy: 'preserve_for_same_source_v1',
});
assert.equal(transfer.contract, 'rapidraw.film_transfer.v1');
assert.equal(transfer.stackPlacement.position, 'scene_creative_end');
assert.throws(() =>
  filmEmulationTransferV1Schema.parse({ ...transfer, stackPlacement: { position: 'scene_creative_custom' } }),
);
assert.throws(() =>
  filmEmulationTransferV1Schema.parse({
    ...transfer,
    profileRef: { ...transfer.profileRef, contentSha256: 'sha256:stale' },
  }),
);

console.log('film transfer contract ok');

#!/usr/bin/env bun

import {
  filmEmulationNodeV1Schema,
  filmEmulationReceiptV1Schema,
  filmSceneInputV1Schema,
} from '../../../../packages/rawengine-schema/src/index.ts';

const node = {
  nodeType: 'film_emulation',
  contractVersion: 1,
  enabled: true,
  profileRef: {
    id: 'rapidraw.reference_film.v1',
    version: '1',
    contentSha256: 'sha256:d84121641d1318f3be759fb5705f04f01721cd35a57e1b238343590bc2b988ef',
  },
  mix: 0.75,
  workingSpace: 'acescg_linear_v1',
  seedPolicy: 'source_stable_v1',
} as const;

filmEmulationNodeV1Schema.parse(node);
filmSceneInputV1Schema.parse({
  domain: 'acescg_linear_v1',
  encoding: 'linear',
  polarity: 'positive',
  inputTransformReceiptSha256: 'sha256:input',
  extendedRangeFinite: true,
});
filmEmulationReceiptV1Schema.parse({
  contractVersion: 1,
  inputDomain: 'acescg_linear_v1',
  outputDomain: 'acescg_linear_v1',
  nodeType: 'film_emulation',
  profileId: node.profileRef.id,
  profileVersion: node.profileRef.version,
  profileContentSha256: node.profileRef.contentSha256,
  mix: node.mix,
  enabled: node.enabled,
  postFilmPreViewHash: 'sha256:post-film',
  fallback: false,
});

if (filmEmulationNodeV1Schema.safeParse({ ...node, mix: 1.1 }).success) {
  throw new Error('Film node schema accepted out-of-range mix');
}

console.log('film scene node contract ok');

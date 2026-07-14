import { describe, expect, test } from 'bun:test';

import { filmResidualLutManifestV1Schema } from '../../../packages/rawengine-schema/src/film/filmEmulationSchemas';

const hash = 'sha256:' + 'a'.repeat(64);

describe('film residual LUT manifest', () => {
  test('accepts a bounded scene-log tetrahedral manifest', () => {
    const manifest = filmResidualLutManifestV1Schema.parse({
      model: 'scene_log_opponent_residual_tetrahedral_v1',
      workingSpace: 'acescg_linear_v1',
      gridSize: 17,
      exposureDomainEv: [-6, 6],
      opponentDomain: [
        [-1, 1],
        [-1, 1],
      ],
      edgeFadeFraction: 0.2,
      neutralGateC0: 0.02,
      storage: 'f32_le',
      assetPath: 'assets/film/reference-residual.f32',
      assetSha256: hash,
      decodedValueSha256: hash,
    });
    expect(manifest.gridSize).toBe(17);
  });

  test('rejects repeated domains and missing provenance hashes', () => {
    expect(() =>
      filmResidualLutManifestV1Schema.parse({
        model: 'scene_log_opponent_residual_tetrahedral_v1',
        workingSpace: 'acescg_linear_v1',
        gridSize: 33,
        exposureDomainEv: [0, 0],
        opponentDomain: [
          [-1, 1],
          [-1, 1],
        ],
        edgeFadeFraction: 0.2,
        neutralGateC0: 0.02,
        storage: 'f32_le',
        assetPath: 'assets/film/reference-residual.f32',
        assetSha256: 'sha256:not-a-hash',
        decodedValueSha256: hash,
      }),
    ).toThrow();
  });
});

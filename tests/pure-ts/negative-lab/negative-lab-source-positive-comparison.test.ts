import { describe, expect, test } from 'bun:test';

import {
  buildNegativeLabSourcePositiveComparisonProof,
  negativeLabSourcePositiveComparisonProofSchema,
} from '../../../src/schemas/negative-lab/negativeLabSourcePositiveComparisonSchemas';

const source = {
  artifactId: 'source-negative-001',
  contentHash: 'sha256:source',
  dimensions: { height: 100, width: 160 },
  path: '/private/roll/scan.nef',
};
const final = {
  artifactId: 'positive-preview-001',
  contentHash: 'sha256:positive',
  dimensions: { height: 100, width: 160 },
};

describe('Negative Lab source/positive comparison proof', () => {
  test('keeps synchronized source and final identity outside recipe state', () => {
    const proof = buildNegativeLabSourcePositiveComparisonProof({
      final,
      finalUrlReady: true,
      mode: 'side_by_side',
      planHash: 'fnv1a32:plan',
      recipeHash: 'fnv1a32:recipe',
      source,
      sourceUrlReady: true,
      warningCodes: [],
    });

    expect(proof.alignment).toEqual({ crop: 'aligned', orientation: 'aligned' });
    expect(proof.mode).toBe('side_by_side');
    expect(proof.source.contentHash).not.toBe(proof.final.contentHash);
    expect(proof.warningCodes).toEqual([]);
    expect(negativeLabSourcePositiveComparisonProofSchema.parse(proof)).toEqual(proof);
  });

  test('records stale source/final readiness and dimension warnings', () => {
    const proof = buildNegativeLabSourcePositiveComparisonProof({
      final: { ...final, dimensions: { height: 90, width: 160 } },
      finalUrlReady: false,
      mode: 'split',
      planHash: 'fnv1a32:plan',
      recipeHash: 'fnv1a32:recipe-next',
      source,
      sourceUrlReady: false,
      warningCodes: ['orientation_unverified'],
    });

    expect(proof.alignment.crop).toBe('warning');
    expect(proof.alignment.orientation).toBe('warning');
    expect(proof.warningCodes).toEqual([
      'orientation_unverified',
      'source_preview_pending',
      'final_preview_pending',
      'dimension_mismatch',
    ]);
  });
});

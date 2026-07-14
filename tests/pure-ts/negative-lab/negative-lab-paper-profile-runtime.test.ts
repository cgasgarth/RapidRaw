import { describe, expect, it } from 'bun:test';

import { negativeLabPaperProfileSchema } from '../../../src/schemas/negative-lab/negativeLabPaperProfileSchemas';
import {
  NEGATIVE_LAB_PAPER_PROFILE_CATALOG,
  neutralNegativeLabPaperProfile,
  resolveNegativeLabPaperProfile,
} from '../../../src/utils/negative-lab/negativeLabPaperProfileRuntime';

describe('Negative Lab paper profile runtime', () => {
  it('keeps the Neutral snapshot identical to the native default identity', () => {
    const neutral = neutralNegativeLabPaperProfile();

    expect(neutral).toMatchObject({
      profileId: 'negative_lab.paper.c41.neutral.v1',
      processFamily: 'c41_color_negative',
      dMin: 0.04,
      dMax: 1.65,
      toeKnee: 0.25,
      shoulderKnee: 0.25,
      midtoneGamma: 1,
      channelCmy: [0, 0, 0],
      baseTint: [0, 0, 0],
      contentHash: 'fnv1a32:neutral_v1',
    });
    expect(negativeLabPaperProfileSchema.parse(neutral)).toEqual(neutral);
  });

  it('resolves a generic color snapshot with provenance and distinct curve terms', () => {
    const generic = resolveNegativeLabPaperProfile('negative_lab.paper.c41.generic_color.v1');
    const neutral = neutralNegativeLabPaperProfile();

    expect(generic.claimClass).toBe('generic_starting_point');
    expect(generic.sourceReferences.length).toBeGreaterThan(0);
    expect(generic.contentHash).not.toBe(neutral.contentHash);
    expect(generic.dMax).toBeGreaterThan(neutral.dMax);
    expect(generic.toeKnee).toBeGreaterThan(neutral.toeKnee);
  });

  it('rejects unknown IDs and preserves catalog validation', () => {
    expect(NEGATIVE_LAB_PAPER_PROFILE_CATALOG.profiles).toHaveLength(2);
    expect(() => resolveNegativeLabPaperProfile('negative_lab.paper.c41.missing.v1')).toThrow(
      'Unknown Negative Lab paper profile',
    );
    expect(() =>
      negativeLabPaperProfileSchema.parse({
        ...neutralNegativeLabPaperProfile(),
        dMax: 0.5,
      }),
    ).toThrow();
  });
});

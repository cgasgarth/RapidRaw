import { describe, expect, test } from 'bun:test';
import { displayTargetChangePayloadSchema } from '../../../src/schemas/tauriEventSchemas';
import { isNewDisplayResourceGeneration } from '../../../src/utils/displayTargetChange';

const change = {
  deviceGeneration: 7,
  displayResourceGeneration: 2,
  target: {
    colorSpace: 'display_encoded_srgb',
    displayId: 42,
    profileSha256: 'sha256:display-profile',
    scaleFactorBits: 4_607_182_418_800_017_400,
  },
};

describe('display target change protocol', () => {
  test('accepts the typed native identity and rejects malformed color contracts', () => {
    expect(displayTargetChangePayloadSchema.parse(change)).toEqual(change);
    expect(
      displayTargetChangePayloadSchema.safeParse({
        ...change,
        target: { ...change.target, colorSpace: 'uncalibrated' },
      }).success,
    ).toBe(false);
  });

  test('only a newer safe generation can supersede the active preview', () => {
    expect(isNewDisplayResourceGeneration(1, 2)).toBe(true);
    expect(isNewDisplayResourceGeneration(2, 2)).toBe(false);
    expect(isNewDisplayResourceGeneration(3, 2)).toBe(false);
    expect(isNewDisplayResourceGeneration(3, Number.MAX_SAFE_INTEGER + 1)).toBe(false);
  });
});

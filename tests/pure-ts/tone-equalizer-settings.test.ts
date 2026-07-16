import { describe, expect, test } from 'bun:test';
import { toneEqualizerSettingsV1Schema } from '../../packages/rawengine-schema/src/tone/toneEqualizerSchemas';
import { INITIAL_TONE_EQUALIZER } from '../../src/utils/adjustments';
import {
  applyToneEqualizerPickerSelection,
  applyToneEqualizerTargetedDelta,
  isToneEqualizerPickerResultCurrent,
  toneEqualizerPickerResponseSchema,
} from '../../src/utils/toneEqualizerPicker';

describe('tone equalizer settings lifecycle', () => {
  test('enforces the versioned nine-band persisted contract', () => {
    expect(toneEqualizerSettingsV1Schema.parse(INITIAL_TONE_EQUALIZER)).toEqual(INITIAL_TONE_EQUALIZER);
    expect(toneEqualizerSettingsV1Schema.parse({ ...INITIAL_TONE_EQUALIZER, previewMode: 4 }).previewMode).toBe(4);
    expect(
      toneEqualizerSettingsV1Schema.safeParse({ ...INITIAL_TONE_EQUALIZER, bandEv: [0, 0, 0, 0, 0, 0, 0, 0] }).success,
    ).toBe(false);
    expect(toneEqualizerSettingsV1Schema.safeParse({ ...INITIAL_TONE_EQUALIZER, smoothingRadius: 65 }).success).toBe(
      false,
    );
  });

  test('rejects stale picker results and applies a current selection atomically', () => {
    const result = toneEqualizerPickerResponseSchema.parse({
      contributingWeights: [0, 0, 0.05, 0.2, 0.5, 0.2, 0.05, 0, 0],
      exposureEv: 0.2,
      graphFingerprint: '0123456789abcdef',
      graphRevision: 'graph-7',
      primaryBand: 4,
      sourceIdentity: '/fixture/current.raw',
      sourceFingerprint: 'fedcba9876543210',
    });
    expect(
      isToneEqualizerPickerResultCurrent(result, {
        active: true,
        graphRevision: 'graph-6',
        sourceIdentity: '/fixture/current.raw',
      }),
    ).toBe(false);
    expect(
      isToneEqualizerPickerResultCurrent(result, {
        active: false,
        graphRevision: 'graph-7',
        sourceIdentity: '/fixture/current.raw',
      }),
    ).toBe(false);
    expect(
      isToneEqualizerPickerResultCurrent(result, {
        active: true,
        graphRevision: 'graph-7',
        sourceIdentity: '/fixture/stale.raw',
      }),
    ).toBe(false);
    expect(
      isToneEqualizerPickerResultCurrent(result, {
        active: true,
        graphRevision: 'graph-7',
        sourceIdentity: '/fixture/current.raw',
      }),
    ).toBe(true);

    const next = applyToneEqualizerPickerSelection(INITIAL_TONE_EQUALIZER, result);
    expect(next.selectedBand).toBe(4);
    expect(next.previewMode).toBe(2);

    const targeted = applyToneEqualizerTargetedDelta(INITIAL_TONE_EQUALIZER, result, 2);
    expect(targeted.enabled).toBe(true);
    expect(targeted.bandEv).toEqual([0, 0, 0.1, 0.4, 1, 0.4, 0.1, 0, 0]);
    expect(targeted.selectedBand).toBe(4);
    expect(INITIAL_TONE_EQUALIZER.bandEv).toEqual([0, 0, 0, 0, 0, 0, 0, 0, 0]);
  });
});

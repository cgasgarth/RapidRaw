import { describe, expect, test } from 'bun:test';
import { toneEqualizerSettingsV1Schema } from '../../packages/rawengine-schema/src/tone/toneEqualizerSchemas';
import {
  type Adjustments,
  INITIAL_ADJUSTMENTS,
  INITIAL_TONE_EQUALIZER,
  normalizeLoadedAdjustments,
} from '../../src/utils/adjustments';
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

  test('keeps legacy process output selected until an explicit upgrade', () => {
    const loaded = normalizeLoadedAdjustments({ exposure: 1.25, rawEngineEditGraphVersion: 1 });
    expect(loaded.rawEngineEditGraphVersion).toBe(1);
    expect(loaded.toneEqualizer).toEqual(INITIAL_TONE_EQUALIZER);
  });

  test('round-trips valid settings and quarantines malformed sidecar state', () => {
    const validBandEv = [0, 0, -0.5, 0.25, 1, 0, 0, 0, 0] as const;
    const loaded = normalizeLoadedAdjustments({
      rawEngineEditGraphVersion: 2,
      toneEqualizer: { ...INITIAL_TONE_EQUALIZER, bandEv: [...validBandEv], enabled: true, selectedBand: 4 },
    });
    expect(loaded.toneEqualizer.bandEv).toEqual(validBandEv);
    expect(loaded.toneEqualizer.bandEv).not.toBe(validBandEv);

    const corrupt = JSON.parse(
      JSON.stringify({
        ...INITIAL_ADJUSTMENTS,
        toneEqualizer: { ...INITIAL_TONE_EQUALIZER, bandEv: [0], smoothingRadius: 1000 },
      }),
    ) as Partial<Adjustments>;
    expect(normalizeLoadedAdjustments(corrupt).toneEqualizer).toEqual(INITIAL_TONE_EQUALIZER);
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

    const next = applyToneEqualizerPickerSelection(INITIAL_ADJUSTMENTS, result);
    expect(next.rawEngineEditGraphVersion).toBe(2);
    expect(next.toneEqualizer.selectedBand).toBe(4);
    expect(next.toneEqualizer.previewMode).toBe(2);
    expect(INITIAL_ADJUSTMENTS.rawEngineEditGraphVersion).toBe(1);

    const targeted = applyToneEqualizerTargetedDelta(INITIAL_ADJUSTMENTS, result, 2);
    expect(targeted.toneEqualizer.enabled).toBe(true);
    expect(targeted.toneEqualizer.bandEv).toEqual([0, 0, 0.1, 0.4, 1, 0.4, 0.1, 0, 0]);
    expect(targeted.toneEqualizer.selectedBand).toBe(4);
    expect(INITIAL_ADJUSTMENTS.toneEqualizer.bandEv).toEqual([0, 0, 0, 0, 0, 0, 0, 0, 0]);
  });
});

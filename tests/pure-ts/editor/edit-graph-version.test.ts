import { describe, expect, test } from 'bun:test';
import {
  bindTypedCurveGraphVersion,
  INITIAL_ADJUSTMENTS,
  normalizeLoadedAdjustments,
} from '../../../src/utils/adjustments';

describe('persisted edit graph version', () => {
  test('new edits and legacy sidecars resolve to the explicit legacy graph', () => {
    expect(INITIAL_ADJUSTMENTS.rawEngineEditGraphVersion).toBe(1);
    expect(normalizeLoadedAdjustments({ ...INITIAL_ADJUSTMENTS, exposure: 12 }).rawEngineEditGraphVersion).toBe(1);
  });

  test('preserves the explicit scene-referred v2 opt-in for native compilation', () => {
    expect(
      normalizeLoadedAdjustments({ ...INITIAL_ADJUSTMENTS, rawEngineEditGraphVersion: 2 }).rawEngineEditGraphVersion,
    ).toBe(2);
  });

  test('survives the sidecar JSON round trip without reinterpretation', () => {
    const saved = JSON.stringify(
      normalizeLoadedAdjustments({ ...INITIAL_ADJUSTMENTS, exposure: 14, rawEngineEditGraphVersion: 2 }),
    );
    const reopened = normalizeLoadedAdjustments(JSON.parse(saved));
    expect(reopened.rawEngineEditGraphVersion).toBe(2);
    expect(reopened.exposure).toBe(14);
  });

  test('migrates legacy Effects visibility once while preserving latent effect values', () => {
    const normalized = normalizeLoadedAdjustments({
      grainAmount: 37,
      sectionVisibility: { basic: false, color: true, curves: true, details: false, effects: false },
      whiteBalanceTechnical: structuredClone(INITIAL_ADJUSTMENTS.whiteBalanceTechnical),
    });

    expect(normalized.effectsEnabled).toBeFalse();
    expect(normalized.grainAmount).toBe(37);
    expect(normalized).not.toHaveProperty('sectionVisibility');
    expect(normalizeLoadedAdjustments(JSON.parse(JSON.stringify(normalized)))).toMatchObject({
      effectsEnabled: false,
      grainAmount: 37,
    });
  });

  test('round-trips typed curve domains without retaining mutable sidecar aliases', () => {
    const loaded = {
      ...structuredClone(INITIAL_ADJUSTMENTS),
      rawEngineEditGraphVersion: 2,
      sceneCurveV1: {
        channelMode: 'luminance_preserving' as const,
        middleGrey: 0.18,
        points: [
          { xEv: -2, yEv: -1.5 },
          { xEv: 2, yEv: 1.75 },
        ],
      },
      outputCurveV1: {
        domain: 'display_referred' as const,
        targetIdentity: 'srgb_sdr' as const,
        sdrReferenceWhiteNits: 100,
        peakNits: 100,
        points: [
          { input: 0, output: 0 },
          { input: 1, output: 1 },
        ],
      },
    };

    const normalized = normalizeLoadedAdjustments(loaded);
    loaded.sceneCurveV1.points[0] = { xEv: -2, yEv: 99 };
    loaded.outputCurveV1.points[1] = { input: 1, output: 0 };

    expect(normalized.sceneCurveV1?.points[0]?.yEv).toBe(-1.5);
    expect(normalized.outputCurveV1?.points[1]?.output).toBe(1);
    expect(normalizeLoadedAdjustments(JSON.parse(JSON.stringify(normalized)))).toMatchObject({
      rawEngineEditGraphVersion: 2,
      sceneCurveV1: normalized.sceneCurveV1,
      outputCurveV1: normalized.outputCurveV1,
    });
  });

  test('promotes copied typed curves to v2 without downgrading legacy-only payloads', () => {
    expect(
      bindTypedCurveGraphVersion({
        sceneCurveV1: {
          channelMode: 'linked_rgb',
          middleGrey: 0.18,
          points: [
            { xEv: -1, yEv: -1 },
            { xEv: 1, yEv: 1 },
          ],
        },
      }).rawEngineEditGraphVersion,
    ).toBe(2);
    expect(bindTypedCurveGraphVersion({ curveMode: 'point' })).toEqual({ curveMode: 'point' });
  });
});

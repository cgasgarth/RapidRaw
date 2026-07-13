import { describe, expect, test } from 'bun:test';
import { INITIAL_ADJUSTMENTS, normalizeLoadedAdjustments } from '../../../src/utils/adjustments';

describe('persisted edit graph version', () => {
  test('new edits and legacy sidecars resolve to the explicit legacy graph', () => {
    expect(INITIAL_ADJUSTMENTS.rawEngineEditGraphVersion).toBe(1);
    expect(normalizeLoadedAdjustments({ exposure: 12 }).rawEngineEditGraphVersion).toBe(1);
  });

  test('preserves an explicit version for the native fail-closed compiler', () => {
    expect(normalizeLoadedAdjustments({ rawEngineEditGraphVersion: 2 }).rawEngineEditGraphVersion).toBe(2);
  });

  test('survives the sidecar JSON round trip without reinterpretation', () => {
    const saved = JSON.stringify(normalizeLoadedAdjustments({ exposure: 14, rawEngineEditGraphVersion: 1 }));
    const reopened = normalizeLoadedAdjustments(JSON.parse(saved));
    expect(reopened.rawEngineEditGraphVersion).toBe(1);
    expect(reopened.exposure).toBe(14);
  });
});

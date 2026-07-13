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
});

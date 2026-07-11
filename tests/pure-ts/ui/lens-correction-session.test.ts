import { describe, expect, test } from 'bun:test';

import {
  buildLensCorrectionDraft,
  createLensSessionRequestGate,
} from '../../../src/components/modals/editing/LensCorrectionModal.tsx';
import { type Adjustments, INITIAL_ADJUSTMENTS } from '../../../src/utils/adjustments.ts';

describe('lens correction session ownership', () => {
  test('builds a complete first-frame draft from the selected image adjustments', () => {
    const distortionParams = {
      k1: 0.1,
      k2: 0.2,
      k3: 0.3,
      model: 1,
      tca_vb: 0.99,
      tca_vr: 1.01,
      vig_k1: 0.4,
      vig_k2: 0.5,
      vig_k3: 0.6,
    };
    const adjustments = adjusted({
      lensCorrectionMode: 'auto',
      lensDistortionAmount: 137,
      lensDistortionEnabled: false,
      lensDistortionParams: distortionParams,
      lensMaker: 'Saved Maker',
      lensModel: 'Saved Model',
      lensTcaAmount: 81,
      lensTcaEnabled: false,
      lensVignetteAmount: 114,
      lensVignetteEnabled: true,
    });

    expect(buildLensCorrectionDraft(adjustments)).toEqual({
      lensCorrectionMode: 'auto',
      lensDistortionAmount: 137,
      lensDistortionEnabled: false,
      lensDistortionParams: distortionParams,
      lensMaker: 'Saved Maker',
      lensModel: 'Saved Model',
      lensTcaAmount: 81,
      lensTcaEnabled: false,
      lensVignetteAmount: 114,
      lensVignetteEnabled: true,
    });
  });

  test('accepts only the latest maker, model, detection, compare, and preview generations', () => {
    const gate = createLensSessionRequestGate();
    for (const kind of ['models', 'distortion', 'detection', 'compare', 'preview'] as const) {
      const stale = gate.begin(kind);
      const current = gate.begin(kind);
      expect(gate.isCurrent(kind, stale)).toBe(false);
      expect(gate.isCurrent(kind, current)).toBe(true);
    }
  });

  test('invalidates event-owned requests without invalidating independent native work', () => {
    const gate = createLensSessionRequestGate();
    const models = gate.begin('models');
    const preview = gate.begin('preview');
    gate.invalidate('models');
    expect(gate.isCurrent('models', models)).toBe(false);
    expect(gate.isCurrent('preview', preview)).toBe(true);
  });

  test('rejects every late response after close and starts a clean keyed session', () => {
    const oldSession = createLensSessionRequestGate();
    const oldRequests = ['resources', 'models', 'distortion', 'detection', 'compare', 'preview'].map(
      (kind) => [kind, oldSession.begin(kind)] as const,
    );
    oldSession.close();
    for (const [kind, requestId] of oldRequests) expect(oldSession.isCurrent(kind, requestId)).toBe(false);

    const reopenedSession = createLensSessionRequestGate();
    const currentPreview = reopenedSession.begin('preview');
    expect(reopenedSession.isCurrent('preview', currentPreview)).toBe(true);
  });

  test('supports resource-effect reactivation while keeping pre-cleanup responses stale', () => {
    const gate = createLensSessionRequestGate();
    const stale = gate.begin('resources');
    gate.close();
    gate.activate();
    const current = gate.begin('resources');
    expect(gate.isCurrent('resources', stale)).toBe(false);
    expect(gate.isCurrent('resources', current)).toBe(true);
  });
});

function adjusted(overrides: Partial<Adjustments>): Adjustments {
  return { ...INITIAL_ADJUSTMENTS, ...overrides };
}

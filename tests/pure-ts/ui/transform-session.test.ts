import { describe, expect, test } from 'bun:test';

import {
  buildTransformDraft,
  createTransformPreviewRequestGate,
  DEFAULT_TRANSFORM_PARAMS,
} from '../../../src/components/modals/editing/TransformModal.tsx';
import { type Adjustments, INITIAL_ADJUSTMENTS } from '../../../src/utils/adjustments.ts';

describe('transform preview session ownership', () => {
  test('builds the complete visible draft synchronously from current adjustments', () => {
    const adjustments = adjusted({
      transformAspect: -18,
      transformDistortion: 23,
      transformHorizontal: -12,
      transformRotate: 3.7,
      transformScale: 117,
      transformVertical: 31,
      transformXOffset: 9,
      transformYOffset: -14,
    });
    expect(buildTransformDraft(adjustments)).toEqual({
      aspect: -18,
      distortion: 23,
      horizontal: -12,
      rotate: 3.7,
      scale: 117,
      vertical: 31,
      x_offset: 9,
      y_offset: -14,
    });
  });

  test('keeps reset defaults independent from the saved first-frame draft', () => {
    const draft = buildTransformDraft(adjusted({ transformRotate: 4, transformScale: 125 }));
    expect(draft).not.toEqual(DEFAULT_TRANSFORM_PARAMS);
    expect(DEFAULT_TRANSFORM_PARAMS).toEqual({
      aspect: 0,
      distortion: 0,
      horizontal: 0,
      rotate: 0,
      scale: 100,
      vertical: 0,
      x_offset: 0,
      y_offset: 0,
    });
  });

  test('rejects an out-of-order preview completion', () => {
    const gate = createTransformPreviewRequestGate();
    const sliderPreview = gate.begin();
    const lineTogglePreview = gate.begin();
    expect(gate.isCurrent(sliderPreview)).toBe(false);
    expect(gate.isCurrent(lineTogglePreview)).toBe(true);
  });

  test('rejects late compare or throttled work after close', () => {
    const gate = createTransformPreviewRequestGate();
    const comparePreview = gate.begin();
    gate.close();
    expect(gate.isCurrent(comparePreview)).toBe(false);
  });

  test('reactivates for StrictMode replay without reviving old requests', () => {
    const gate = createTransformPreviewRequestGate();
    const oldInitialPreview = gate.begin();
    gate.close();
    gate.activate();
    const reopenedInitialPreview = gate.begin();
    expect(gate.isCurrent(oldInitialPreview)).toBe(false);
    expect(gate.isCurrent(reopenedInitialPreview)).toBe(true);
  });
});

function adjusted(overrides: Partial<Adjustments>): Adjustments {
  return { ...INITIAL_ADJUSTMENTS, ...overrides };
}

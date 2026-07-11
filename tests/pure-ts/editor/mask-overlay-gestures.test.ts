import { describe, expect, test } from 'bun:test';

import {
  type MaskParameters,
  translateLinearMask,
  translateRadialMask,
} from '../../../src/components/panel/editor/MaskOverlaySurface';

const parameters = (overrides: Partial<MaskParameters> = {}): MaskParameters => ({
  centerX: 100,
  centerY: 80,
  endX: 60,
  endY: 70,
  feather: 0.5,
  radiusX: 30,
  radiusY: 20,
  range: 12,
  rotation: 25,
  startX: 20,
  startY: 30,
  targetX: -1,
  targetY: -1,
  ...overrides,
});

describe('mask overlay gesture transforms', () => {
  test('moves a radial mask center while preserving its normalized shape', () => {
    const moved = translateRadialMask(parameters({ radiusX: -30, rotation: 385 }), 15, -10);

    expect(moved).toMatchObject({
      centerX: 115,
      centerY: 70,
      feather: 0.5,
      radiusX: 30,
      radiusY: 20,
      rotation: 25,
    });
  });

  test('moves both linear gradient handles by the same image-space delta', () => {
    const moved = translateLinearMask(parameters(), -5, 8);

    expect(moved).toMatchObject({
      endX: 55,
      endY: 78,
      startX: 15,
      startY: 38,
    });
    expect(moved.endX - moved.startX).toBe(40);
    expect(moved.endY - moved.startY).toBe(40);
  });
});
